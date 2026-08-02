import { spawn } from "child_process";
import {
  completeProcess,
  getProcess,
  killProcess,
  registerProcess,
} from "@/lib/process-registry";
import { getProviderForCard } from "@/lib/platform/active";

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
): Promise<{ response: string; cost?: number; duration?: number }> {
  const {
    prompt,
    cwd,
    aiPlatform,
    timeoutMs = 10 * 60 * 1000,
    tracking,
    requireExitZero = false,
  } = options;

  // Kill any existing process for this card so a second click doesn't race the first.
  if (tracking && getProcess(tracking.processKey)) {
    killProcess(tracking.processKey);
  }

  const provider = getProviderForCard({ aiPlatform });
  const label = options.label ?? provider.displayName;
  const args = provider.buildAutonomousArgs({ prompt });

  console.log(`[${label}] Running in ${cwd}:`);
  console.log(`[${label}] Prompt length: ${prompt.length} chars`);

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

    let stdout = "";
    let stderr = "";

    cliProcess.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
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
      console.log(`[${label}] stdout length: ${stdout.length}`);

      if (code !== 0 && (requireExitZero || !stdout.trim())) {
        reject(new Error(`${provider.displayName} exited with code ${code}: ${stderr}`));
        return;
      }

      const parsed = provider.parseJsonResponse(stdout);
      if (parsed.isError) {
        reject(new Error(parsed.result || `${provider.displayName} returned an error`));
        return;
      }

      resolve({
        response: parsed.result,
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
