import { spawn } from "child_process";
import {
  completeProcess,
  getProcess,
  killProcess,
  registerProcess,
} from "@/lib/process-registry";
import { getProviderForCard } from "@/lib/platform/active";

interface RunAutonomousOptions {
  prompt: string;
  cwd: string;
  processKey: string;
  cardId: string;
  cardTitle: string;
  displayId: string | null;
  aiPlatform?: string | null;
  /** Timeout in ms; defaults to 10 minutes. */
  timeoutMs?: number;
}

/**
 * Spawn the active platform provider's CLI in autonomous mode, streaming
 * stdout/stderr, enforcing a timeout, and parsing the final JSON response.
 *
 * Registers the child process via the process registry so the UI can surface
 * it and so a second request for the same card can pre-emptively kill the
 * first (`processKey` must be unique per card).
 *
 * The caller is responsible for calling `completeProcess(processKey)` after
 * it has finished post-processing (e.g. DB writes) — deliberately *not* done
 * here so the UI stays "running" until the card row is actually up to date.
 */
export async function runAutonomousCli(
  options: RunAutonomousOptions,
): Promise<{ response: string; cost?: number; duration?: number }> {
  const {
    prompt,
    cwd,
    processKey,
    cardId,
    cardTitle,
    displayId,
    aiPlatform,
    timeoutMs = 10 * 60 * 1000,
  } = options;

  // Kill any existing process for this card so a second click doesn't race the first.
  if (getProcess(processKey)) {
    killProcess(processKey);
  }

  const provider = getProviderForCard({ aiPlatform });
  const args = provider.buildAutonomousArgs({ prompt });

  console.log(`[${provider.displayName}] Running in ${cwd}:`);
  console.log(`[${provider.displayName}] Prompt length: ${prompt.length} chars`);

  return new Promise((resolve, reject) => {
    const cliProcess = spawn(provider.getCliPath(), args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: provider.getCIEnv(),
    });

    // Close stdin immediately — equivalent to `< /dev/null`.
    cliProcess.stdin?.end();

    registerProcess(processKey, cliProcess, {
      cardId,
      sectionType: null,
      processType: "autonomous",
      cardTitle,
      displayId,
      startedAt: new Date().toISOString(),
    });

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
      reject(new Error(`${provider.displayName} timed out after ${Math.round(timeoutMs / 60000)} minutes`));
    }, timeoutMs);

    cliProcess.on("close", (code) => {
      clearTimeout(timeout);

      if (stderr) {
        console.log(`[${provider.displayName}] stderr: ${stderr}`);
      }
      console.log(`[${provider.displayName}] stdout length: ${stdout.length}`);

      if (code !== 0 && !stdout.trim()) {
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
