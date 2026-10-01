import type { Card, Status } from "./types";

/**
 * Statuses that take a card out of the run queue. Mirrors the
 * `cards_queue_position_reset` trigger in drizzle/0017: a card pulled into
 * Human Test by hand, withdrawn or sent back to Ideation has nothing left for
 * an implementation run to do, and a stale "#2" on its face would say it does.
 */
export const QUEUE_CLEARING_STATUSES: ReadonlySet<Status> = new Set<Status>([
  "test",
  "completed",
  "withdrawn",
  "ideation",
]);

export function compareByQueuePosition(
  a: Pick<Card, "queuePosition" | "taskNumber">,
  b: Pick<Card, "queuePosition" | "taskNumber">
): number {
  const ap = a.queuePosition ?? Number.MAX_SAFE_INTEGER;
  const bp = b.queuePosition ?? Number.MAX_SAFE_INTEGER;
  if (ap !== bp) return ap - bp;
  return (a.taskNumber ?? Number.MAX_SAFE_INTEGER) - (b.taskNumber ?? Number.MAX_SAFE_INTEGER);
}

/**
 * Card id → 1-based rank in the queue. Positions can have gaps (the trigger
 * clears one card without renumbering the rest), so the badge reads rank from
 * the order rather than printing the stored number.
 */
export function queueRanks(cards: Pick<Card, "id" | "queuePosition" | "taskNumber">[]): Map<string, number> {
  const ranks = new Map<string, number>();
  cards
    .filter((card) => card.queuePosition !== null)
    .sort(compareByQueuePosition)
    .forEach((card, index) => ranks.set(card.id, index + 1));
  return ranks;
}

/**
 * Why a card cannot wait in the run queue, or null when it can. The queue only
 * ever starts autonomous implementation runs: a plan run, a re-test or a
 * pre-verify needs a person to read what it wrote before anything else
 * happens, and an interactive terminal session never reports that it ended.
 *
 * `phase` is the server's `detectPhase`, not the board's: the queue starts the
 * run the Start route would, so it has to agree with that route.
 */
export function queueIneligibleReason(input: {
  status: string;
  hasDescription: boolean;
  phase: string;
  processingType: string | null;
  projectMode: string | null;
}): string | null {
  if (QUEUE_CLEARING_STATUSES.has(input.status as Status)) return `it is in ${input.status}`;
  if (input.projectMode === "work") return "Work projects have no implementation run";
  if (!input.hasDescription) return "it has no description";
  if (input.phase === "planning") return "it has no plan yet";
  if (input.phase !== "implementation") return "it already has a test checklist";
  if (input.processingType) return "a run is already going on it";
  return null;
}

/** A card ahead in line whose plan names files this card's plan also names. */
export interface QueueOverlap {
  cardId: string;
  displayId: string;
  files: string[];
}

/** A queued or running card, as far as sharing a working copy goes. */
export interface WorkingCopyRun {
  id: string;
  projectId: string | null;
  runsInWorktree: boolean;
}

/**
 * The run ahead of a worktree-less card that will leave its uncommitted
 * changes in the same checkout, or null when there is none. `ahead` is in run
 * order — running first, then the queue up to this card — and the closest one
 * wins, since its diff is the one this card starts on top of. A run in its own
 * worktree leaves the checkout alone, and a card in another project has a
 * checkout of its own, so neither counts.
 */
export function sharedWorkingCopyWith<T extends WorkingCopyRun>(self: WorkingCopyRun, ahead: T[]): T | null {
  if (self.runsInWorktree) return null;
  for (let i = ahead.length - 1; i >= 0; i--) {
    const other = ahead[i];
    if (other.id === self.id || other.runsInWorktree) continue;
    if (other.projectId === self.projectId) return other;
  }
  return null;
}

/** GET /api/queue. */
export interface QueueSnapshot {
  /** In run order; the first one starts next. */
  items: {
    cardId: string;
    displayId: string;
    title: string;
    overlaps: QueueOverlap[];
    /** Whether its run will get its own branch, decided as the run's start would decide it. */
    runsInWorktree: boolean;
  }[];
  armed: boolean;
  pausedReason: string | null;
  /** The autonomous run the queue is waiting behind, if any. */
  running: { cardId: string; displayId: string; fromQueue: boolean } | null;
}

/** POST /api/queue: the snapshot plus warnings that never block the add. */
export interface QueueAddResult extends QueueSnapshot {
  overlaps: QueueOverlap[];
  worktreeWarning: string | null;
}
