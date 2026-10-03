import { spawn } from "child_process";
import { existsSync } from "fs";
import {
  completeProcess,
  getProcess,
  killProcess,
  registerProcess,
} from "@/lib/process-registry";
import { recordRunSession } from "@/lib/card-sessions";
import { getProviderForCard } from "@/lib/platform/active";
import { adaptMcpToolNames } from "@/lib/platform/mcp-tool-names";
import type { OneShotRunKind, ParsedRunOutput } from "@/lib/platform/types";
import {
  ENDED_WHILE_WAITING_WARNING,
  selectRunOutput,
  type RunOutputContract,
} from "./select-run-output";
import { formatRunDuration, shouldKillForIdle } from "./run-timeout";

/** Process-registry label; must match the values the UI filters on. */
export type AutonomousProcessType = "autonomous" | "evaluate" | "quick-fix" | "generate";

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
  /** Label for the card's CLI session list. Defaults to processType; Start
   *  passes its phase so a plan run and a verify run read differently. */
  runKind?: string;
}

export interface RunAutonomousOptions {
  prompt: string;
  cwd: string;
  aiPlatform?: string | null;
  /** Wall-clock timeout in ms; defaults to 10 minutes. */
  timeoutMs?: number;
  /**
   * Kill the run once its stdout has been silent this long. Omit — or pass a
   * value not below `timeoutMs` — to keep only the wall clock, which is what
   * short runs like evaluate and enrich want.
   */
  idleTimeoutMs?: number;
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
  /**
   * Pins the provider's model, effort and MCP set for a one-shot run. Unlike
   * `tracking.runKind`, which only labels the session list, this changes how
   * the CLI is launched. Omit to inherit the user's global CLI settings.
   */
  runKind?: OneShotRunKind;
}

export interface AutonomousRunResult {
  response: string;
  /** Non-null when the output had to be guessed at; surface it to the user. */
  warning: string | null;
  /** The run stopped on a background wait that never came back (IDE-319). */
  endedWhileWaiting: boolean;
  cost?: number;
  duration?: number;
}

/**
 * Spawn the active platform provider's CLI in autonomous mode, enforcing its
 * wall-clock and (optional) idle timeouts and parsing the response.
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
    idleTimeoutMs,
    tracking,
    requireExitZero = false,
    contract,
    runKind,
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
  const args = provider.buildAutonomousArgs({ prompt: adaptedPrompt, runKind });

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
    // A collector keeps no raw stdout, so hold on to its tail for the error
    // message of a run that died without saying why on stderr.
    let stdoutTail = "";
    // Every stream-json line — tool call, tool result, assistant turn, a
    // sub-agent's turns, thinking ticks — is proof the run is still working,
    // so stdout is the idle clock. Claude also heartbeats a long Bash call
    // every 30s, so a hung foreground command is left to BASH_DEFAULT_TIMEOUT_MS.
    let lastActivityAt = Date.now();

    cliProcess.stdout?.on("data", (data: Buffer) => {
      lastActivityAt = Date.now();
      const text = data.toString();
      stdoutLength += text.length;
      stdoutTail = (stdoutTail + text).slice(-2000);
      if (collector) {
        collector.push(text);
      } else {
        stdout += text;
      }
    });

    cliProcess.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    // Only the collector-backed providers are known to stream events as they
    // work; one without could print nothing until the end and look idle the
    // whole run.
    const idleMs =
      collector && idleTimeoutMs !== undefined && idleTimeoutMs < timeoutMs ? idleTimeoutMs : null;

    // Both messages keep "timed out" — run-error.ts keys the queue's
    // "run timed out" pause on it.
    const timeout = setTimeout(() => {
      clearTimers();
      cliProcess.kill();
      const suffix = idleMs !== null ? " (hard limit)" : "";
      reject(new Error(`${label} timed out after ${formatRunDuration(timeoutMs)}${suffix}`));
    }, timeoutMs);

    const idleCheck =
      idleMs !== null
        ? setInterval(() => {
            if (!shouldKillForIdle(Date.now(), lastActivityAt, idleMs)) return;
            clearTimers();
            cliProcess.kill();
            reject(new Error(`${label} timed out: no output for ${formatRunDuration(idleMs)}`));
          }, Math.min(30_000, idleMs))
        : null;

    const clearTimers = () => {
      clearTimeout(timeout);
      if (idleCheck) clearInterval(idleCheck);
    };

    cliProcess.on("close", (code) => {
      clearTimers();

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

      // Before any resolve/reject: a run that failed or timed out is the one
      // most worth resuming, so it gets recorded too. Timeout already rejected,
      // but the kill still lands here.
      if (tracking && parsed.sessionId) {
        try {
          recordRunSession({
            sessionId: parsed.sessionId,
            cardId: tracking.cardId,
            provider: provider.id,
            cwd,
            runKind: tracking.runKind ?? tracking.processType,
          });
        } catch (error) {
          console.warn(`[${label}] could not record session ${parsed.sessionId}:`, error);
        }
      }

      // Not `!stdout.trim()`: under stream-json a `system/init` line lands
      // within milliseconds, so stdout is never empty and that guard would
      // never fire again. A terminating result envelope is what actually
      // distinguishes a finished run from a crashed one.
      if (code !== 0 && (requireExitZero || !parsed.sawResultEnvelope)) {
        // Stderr is often empty when the CLI reports its error in the result
        // envelope or on stdout, and "code 1:" alone tells the user nothing.
        const output = stderr.trim() || parsed.result?.trim() || stdoutTail.trim().slice(-500);
        reject(new Error(`${provider.displayName} exited with code ${code}: ${output}`));
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

      if (selected.endedWhileWaiting) {
        console.warn(`[${label}] ${ENDED_WHILE_WAITING_WARNING}`);
      }

      resolve({
        response: selected.text,
        // The stranded wait is the real reason the output looks wrong, so it
        // outranks the format complaint it usually comes with.
        warning: selected.endedWhileWaiting
          ? `${ENDED_WHILE_WAITING_WARNING} — output may be incomplete.`
          : selected.warning,
        endedWhileWaiting: selected.endedWhileWaiting,
        cost: parsed.cost,
        duration: parsed.duration,
      });
    });

    cliProcess.on("error", (error: NodeJS.ErrnoException) => {
      clearTimers();
      // spawn reports a missing cwd as ENOENT on the binary, which reads as
      // "CLI not installed" when the project folder is what moved.
      if (error.code === "ENOENT" && !existsSync(cwd)) {
        reject(new Error(`Working directory not found: ${cwd}`));
        return;
      }
      reject(error);
    });
  });
}

export { completeProcess };
