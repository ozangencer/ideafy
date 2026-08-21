import { spawn } from "child_process";
import {
  completeProcess,
  getProcess,
  killProcess,
  registerProcess,
} from "@/lib/process-registry";
import { getProviderForCard } from "@/lib/platform/active";
import { adaptMcpToolNames } from "@/lib/platform/mcp-tool-names";
import type { ParsedRunOutput } from "@/lib/platform/types";
import { selectRunOutput, type RunOutputContract } from "./select-run-output";

/** Process-registry label; must match the values the UI filters on. */
export type AutonomousProcessType = "autonomous" | "evaluate" | "quick-fix";

/**
 * Card context needed to surface the run in the process registry. Omit it
 * entirely for runs with no card behind them (e.g. project narrative), which
 * then go untracked exactly as they did before.
 */
export interface AutonomousTracking {
  processKey: string;
  cardId: string;
  cardTitle: string;
  displayId: string | null;
  processType: AutonomousProcessType;
}

export interface RunAutonomousOptions {
  prompt: string;
  cwd: string;
  aiPlatform?: string | null;
  /** Timeout in ms; defaults to 10 minutes. */
  timeoutMs?: number;
  /** Prefix for log lines and the timeout message. Defaults to the provider name. */
  label?: string;
  /** Omit to skip process-registry tracking. */
  tracking?: AutonomousTracking;
  /**
   * Reject on any non-zero exit, even when stdout carried content. The default
   * (false) tolerates a non-zero exit that still produced output, which is how
   * the card-driven runs have always behaved.
   */
  requireExitZero?: boolean;
  /**
   * What this run's output must look like to be recognisable as its product.
   * Without one the runner falls back to a length heuristic and flags it.
   */
  contract?: RunOutputContract;
}

export interface AutonomousRunResult {
  response: string;
  /** Non-null when the output had to be guessed at; surface it to the user. */
  warning: string | null;
  cost?: number;
  duration?: number;
}

/**
 * Spawn the active platform provider's CLI in autonomous mode, enforcing a
 * timeout and parsing the response.
 *
 * When `tracking` is supplied the child is registered with the process registry
 * so the UI can surface it and a second request for the same card pre-emptively
 * kills the first (`processKey` must be unique per card).
 *
 * The caller is responsible for calling `completeProcess(processKey)` after it
 * has finished post-processing (e.g. DB writes) — deliberately *not* done here
 * so the UI stays "running" until the card row is actually up to date.
 */
export async function runAutonomousCli(
  options: RunAutonomousOptions,
): Promise<AutonomousRunResult> {
  const {
    prompt,
    cwd,
    aiPlatform,
    timeoutMs = 10 * 60 * 1000,
    tracking,
    requireExitZero = false,
    contract,
  } = options;

  // Kill any existing process for this card so a second click doesn't race the first.
  if (tracking && getProcess(tracking.processKey)) {
    killProcess(tracking.processKey);
  }

  const provider = getProviderForCard({ aiPlatform });
  const label = options.label ?? provider.displayName;
  // Prompt builders spell MCP tools Claude-style; every other CLI prefixes them
  // differently. Adapting here rather than in each builder keeps the single
  // choke point that every autonomous phase already passes through.
  const adaptedPrompt = adaptMcpToolNames(prompt, provider.id);
  const args = provider.buildAutonomousArgs({ prompt: adaptedPrompt });

  console.log(`[${label}] Running in ${cwd}:`);
  console.log(`[${label}] Prompt length: ${adaptedPrompt.length} chars`);

  return new Promise((resolve, reject) => {
    const cliProcess = spawn(provider.getCliPath(), args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: provider.getCIEnv(),
    });

    // Close stdin immediately — equivalent to `< /dev/null`.
    cliProcess.stdin?.end();

    if (tracking) {
      registerProcess(tracking.processKey, cliProcess, {
        cardId: tracking.cardId,
        sectionType: null,
        processType: tracking.processType,
        cardTitle: tracking.cardTitle,
        displayId: tracking.displayId,
        startedAt: new Date().toISOString(),
      });
    }

    // Providers that can decompose their own output stream do so incrementally;
    // the rest keep the old buffer-everything path.
    const collector = provider.createRunOutputCollector?.();
    let stdout = "";
    let stderr = "";
    let stdoutLength = 0;

    cliProcess.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      stdoutLength += text.length;
      if (collector) {
        collector.push(text);
      } else {
        stdout += text;
      }
    });

    cliProcess.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      cliProcess.kill();
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 60000)} minutes`));
    }, timeoutMs);

    cliProcess.on("close", (code) => {
      clearTimeout(timeout);

      if (stderr) {
        console.log(`[${label}] stderr: ${stderr}`);
      }
      console.log(`[${label}] stdout length: ${stdoutLength}`);

      let parsed: ParsedRunOutput;
      if (collector) {
        parsed = collector.finish();
      } else {
        const legacy = provider.parseJsonResponse(stdout);
        parsed = {
          candidates: [],
          result: legacy.result,
          cost: legacy.cost,
          duration: legacy.duration,
          isError: legacy.isError,
          // Nothing better to go on for these providers, and treating output as
          // proof of completion is what the old guard below did anyway.
          sawResultEnvelope: !!stdout.trim(),
          injectedUserMessages: 0,
        };
      }

      // Not `!stdout.trim()`: under stream-json a `system/init` line lands
      // within milliseconds, so stdout is never empty and that guard would
      // never fire again. A terminating result envelope is what actually
      // distinguishes a finished run from a crashed one.
      if (code !== 0 && (requireExitZero || !parsed.sawResultEnvelope)) {
        reject(new Error(`${provider.displayName} exited with code ${code}: ${stderr}`));
        return;
      }

      if (parsed.isError) {
        // The error text lives in `result`; candidate selection has no business
        // running on a failed run.
        reject(new Error(parsed.result || `${provider.displayName} returned an error`));
        return;
      }

      const selected = selectRunOutput(parsed, contract);
      if (selected.warning) {
        console.warn(
          `[${label}] ${selected.warning} ` +
            `(adaylar: ${selected.candidateCount}, segment: ${selected.segmentCount})`,
        );
      }

      resolve({
        response: selected.text,
        warning: selected.warning,
        cost: parsed.cost,
        duration: parsed.duration,
      });
    });

    cliProcess.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

export { completeProcess };
