const MIN = 60 * 1000;

/**
 * A run is killed on two separate clocks (IDE-409). The idle limit catches a
 * run that has gone quiet — a hung command, a wait that never returns. The hard
 * limit only exists so the queue can never hang forever (IDE-376). A single
 * wall clock did both jobs badly: a run still streaming tool calls was killed
 * at 10 minutes just because the card was big.
 */
export interface RunLimits {
  /** Wall-clock ceiling, however busy the run is. */
  hardMs: number;
  /** Longest stretch without any stdout before the run counts as hung. */
  idleMs: number;
}

/**
 * Has to sit well above BASH_DEFAULT_TIMEOUT_MS (240s): one long build or test
 * suite prints nothing to the run's stream until it returns.
 */
export const DEFAULT_RUN_IDLE_TIMEOUT_MS = 8 * MIN;

/**
 * Ceiling for an implementation run, by the card's complexity. A flat 10
 * minutes killed a high-complexity plan while the run was still reading the
 * files it had to change (IDE-356); the idle limit now catches a stuck run, so
 * these only bound how long the queue can be held.
 */
const IMPLEMENTATION_HARD_LIMIT_MINUTES: Record<string, number> = {
  trivial: 20,
  low: 20,
  medium: 40,
  high: 60,
  very_high: 90,
};

/** Planning, retest and verify do not grow with the card, but did hit 10 minutes. */
const OTHER_PHASE_HARD_LIMIT_MINUTES = 30;

/**
 * A pre-verify that walks every group left (IDE-449) grows with the checklist:
 * a regression group can take far longer than the core flow. Each unticked
 * item past the core flow buys a few minutes, up to a ceiling the queue can
 * still live with.
 */
const VERIFY_ALL_MINUTES_PER_ITEM = 3;
const VERIFY_ALL_MAX_MINUTES = 90;

/**
 * Idle limit for every run that opts into the idle watcher. The env override
 * is an escape hatch, same pattern as BASH_DEFAULT_TIMEOUT_MS.
 */
export function runIdleTimeoutMs(): number {
  const override = Number(process.env.IDEAFY_RUN_IDLE_TIMEOUT_MS);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_RUN_IDLE_TIMEOUT_MS;
}

export function autonomousRunLimits(
  phase: string,
  complexity: string | null | undefined,
  // Verify on the `all` scope: unticked items it walks outside the core flow.
  verifyAllExtraItems = 0,
): RunLimits {
  let minutes =
    phase === "implementation"
      ? IMPLEMENTATION_HARD_LIMIT_MINUTES[complexity ?? ""] ?? 40
      : OTHER_PHASE_HARD_LIMIT_MINUTES;
  if (phase === "verify" && verifyAllExtraItems > 0) {
    minutes = Math.min(minutes + VERIFY_ALL_MINUTES_PER_ITEM * verifyAllExtraItems, VERIFY_ALL_MAX_MINUTES);
  }
  return { hardMs: minutes * MIN, idleMs: runIdleTimeoutMs() };
}

export function shouldKillForIdle(now: number, lastActivityAt: number, idleMs: number): boolean {
  return now - lastActivityAt >= idleMs;
}

/** "8 minutes", or seconds when an override pushed the limit under a minute. */
export function formatRunDuration(ms: number): string {
  if (ms < MIN) return `${Math.round(ms / 1000)} seconds`;
  const minutes = Math.round(ms / MIN);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
