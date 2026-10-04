import { execFileSync } from "child_process";

// Dependency-free on purpose: standalone Node scripts reuse this outside Next.

export interface StopProcessGroupOptions {
  /** How long to wait after SIGTERM before escalating to SIGKILL. */
  graceMs?: number;
  /** How often to poll whether the group is gone. */
  pollMs?: number;
}

function alive(target: number): boolean {
  try {
    // Signal 0 only checks existence; a negative target probes the whole group.
    process.kill(target, 0);
    return true;
  } catch (error) {
    // EPERM means something is there that we may not signal — still alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * True when `pid` leads its own process group. A spawn with `detached: true`
 * always does; a stale PID that the OS handed to an unrelated process usually
 * does not, and signalling its group would hit innocent bystanders.
 */
export function isProcessGroupLeader(pid: number): boolean {
  if (process.platform === "win32") return false;
  try {
    const pgid = execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return Number(pgid) === pid;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Stop a detached command together with everything it spawned.
 *
 * `npm run dev` is only the group leader; `next dev` and `next-server` sit
 * below it. Signalling the leader alone leaves them orphaned — on the SIGKILL
 * path that is guaranteed, because npm never gets the chance to forward it.
 * So the signals go to the group (`-pid`): SIGTERM first, SIGKILL once the
 * grace period runs out.
 *
 * When `pid` is not a group leader (a reused PID), only that one process is
 * signalled, which is what the old behaviour did.
 *
 * Resolves true once nothing is left, false if something survived or there
 * was nothing to stop.
 */
export async function stopProcessGroup(
  pid: number,
  { graceMs = 3000, pollMs = 100 }: StopProcessGroupOptions = {}
): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 1) return false;

  const target = isProcessGroupLeader(pid) ? -pid : pid;

  try {
    process.kill(target, "SIGTERM");
  } catch {
    // Nothing to signal — already gone.
    return false;
  }

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!alive(target)) return true;
    await sleep(pollMs);
  }

  try {
    process.kill(target, "SIGKILL");
  } catch {
    // Exited between the last poll and now.
    return true;
  }

  // SIGKILL cannot be ignored, but the kernel still needs a moment to reap.
  for (let i = 0; i < 10; i++) {
    if (!alive(target)) return true;
    await sleep(pollMs);
  }
  return !alive(target);
}
