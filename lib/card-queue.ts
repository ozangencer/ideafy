import type { Card, Status } from "./types";

/**
 * Statuses that take a card out of the run queue when it moves into them.
 * Mirrors the `cards_queue_position_reset` trigger (drizzle/0018): a card
 * pulled into Human Test by hand, withdrawn or sent back to Ideation has
 * nothing left for an implementation run to do, and a stale "#2" on its face
 * would say it does. The trigger fires on the move only — a card already in
 * Human Test can be queued for pre-verify, and re-saving its status keeps it.
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

/** What a queued card's run will do: build it, or walk its core flow. */
export type QueueRunKind = "implementation" | "verify";

/**
 * Why a card cannot wait in the run queue, or null when it can. The queue
 * starts two kinds of autonomous run. Implementation, from Backlog or In
 * Progress, for a card with a plan and no checklist yet. And pre-verify, for a
 * Human Test card whose checklist names its core flow: it changes no status,
 * nothing starts behind it, and its result is read by the person who was
 * going to walk that checklist anyway. A plan run or a re-test still needs a
 * person to read what it wrote before anything else happens, and an
 * interactive terminal session never reports that it ended.
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
  /** Whether the checklist opens with a `Core flow` / `Temel akış` group. */
  hasCoreFlow: boolean;
  gitBranchStatus: string | null;
}): string | null {
  if (input.status === "test") {
    if (input.phase !== "verify") return "it is in test";
    if (input.projectMode === "work") return "Work projects have no queued pre-verify";
    if (!input.hasDescription) return "it has no description";
    // Same rule as the board's Pre-verify button: without the heading the
    // agent cannot tell which items are essential and would tick nothing.
    if (!input.hasCoreFlow) return "its checklist has no core-flow group";
    if (input.gitBranchStatus === "rolled_back") return "its branch was rolled back";
    if (input.processingType) return "a run is already going on it";
    return null;
  }
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
  kind: QueueRunKind;
}

/**
 * The run ahead of a worktree-less card that will leave its uncommitted
 * changes in the same checkout, or null when there is none. `ahead` is in run
 * order — running first, then the queue up to this card — and the closest one
 * wins, since its diff is the one this card starts on top of. A run in its own
 * worktree leaves the checkout alone, a pre-verify only ticks boxes and leaves
 * no diff behind, and a card in another project has a checkout of its own, so
 * none of those count.
 */
export function sharedWorkingCopyWith<T extends WorkingCopyRun>(self: WorkingCopyRun, ahead: T[]): T | null {
  if (self.runsInWorktree) return null;
  for (let i = ahead.length - 1; i >= 0; i--) {
    const other = ahead[i];
    if (other.id === self.id || other.runsInWorktree || other.kind === "verify") continue;
    if (other.projectId === self.projectId) return other;
  }
  return null;
}

/** What a live or about-to-start run does in its folder. */
export type LiveRunKind = "planning" | "implementation" | "retest" | "verify" | "quick-fix";

/** A running or about-to-start run, as far as sharing a folder at once goes. */
export interface FolderRun {
  id: string;
  projectId: string | null;
  runsInWorktree: boolean;
  kind: LiveRunKind;
}

/**
 * The live run that would work in the same folder as `self` at the same time,
 * or null when there is none. Unlike sharedWorkingCopyWith this is about two
 * processes side by side, not one diff left for the next: a pre-verify on main
 * breaks just as surely when another run is writing next to it. A run in its
 * own worktree has a folder to itself, and planning writes no code, so neither
 * counts on either side.
 */
export function conflictingLiveRun<T extends FolderRun>(self: FolderRun, live: T[]): T | null {
  if (self.runsInWorktree || self.kind === "planning") return null;
  for (const other of live) {
    if (other.id === self.id || other.runsInWorktree || other.kind === "planning") continue;
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
    /**
     * Whether its run lands in a worktree, decided as the run's start would
     * decide it. For a pre-verify that is the card's own active worktree,
     * not its branch choice: the checklist is walked where the code was written.
     */
    runsInWorktree: boolean;
    kind: QueueRunKind;
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

/**
 * DELETE /api/queue with `{ all: true }`: the snapshot plus what Clear took
 * out, in run order, and whether the queue was running — what Undo needs to
 * put it back as it was.
 */
export interface QueueClearResult extends QueueSnapshot {
  cleared: { cardId: string; displayId: string }[];
  wasArmed: boolean;
}

/** PATCH /api/queue `restore`: the snapshot plus the cards Undo could not put back. */
export interface QueueRestoreResult extends QueueSnapshot {
  skipped: { cardId: string; displayId: string; reason: string }[];
}
