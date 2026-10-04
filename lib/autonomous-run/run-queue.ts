import { sqlite } from "@/lib/db";
import {
  clearQueue as clearQueueRows,
  dequeueCard as dequeueQueueRow,
  enqueueCard as enqueueQueueRow,
  getQueueRow,
  listQueueRows as listSharedQueueRows,
  queueDisplayId,
  queueKindOf,
  queueRowIneligibleReason,
  restoreQueueCards,
  type ClearedQueueCard,
  type QueueRow,
} from "@/lib/card-ops";
import { getAllProcesses } from "@/lib/process-registry";
import { recordActivity } from "@/lib/activity-registry";
import { detectPhase } from "@/lib/prompts";
import { infrastructureRunError } from "@/lib/run-error";
import {
  conflictingLiveRun,
  sharedWorkingCopyWith,
  type ChatWriteBlock,
  type LiveRunKind,
  type QueueOverlap,
  type QueueSnapshot,
} from "@/lib/card-queue";
import { extractPlanFiles, sharedPlanFiles } from "@/lib/plan-files";
import { shouldUseWorktree } from "@/lib/workspace";
import { isTestActionFor } from "@/lib/ai/allowed-tools";
import type { VerifyScope } from "@/lib/test-progress";

/**
 * The run queue: cards lined up for an autonomous implementation or pre-verify
 * run, started one at a time as the previous run ends — whether it ended well
 * or not.
 *
 * The order lives on the cards (`queue_position`), so it survives a restart.
 * Whether the queue is *running* does not: `armed` sits in memory like the
 * process registry, and a fresh process comes up paused. A queue that resumed
 * itself on launch would start a card the moment Ideafy opened, possibly
 * hours after you last looked at what it was about to do.
 */

export type RunOutcome = "completed" | "failed" | "stopped";

interface RunQueueState {
  armed: boolean;
  /** Why the queue stopped. Adding a card does not re-arm a paused queue. */
  pausedReason: string | null;
  /** Unclassified failures in a row; the second one pauses. */
  consecutiveFailures: number;
  /** Held while advanceQueue picks and launches, so two calls cannot both start. */
  advancing: boolean;
  /**
   * Cards with a Start or Quick fix run between its first line and its last,
   * manual or queued. The process registry only learns about a run once its
   * worktree exists, which can take seconds; this covers that gap.
   */
  inFlight: Set<string>;
  /** The card the queue itself launched last, while it runs. */
  queueStartedCardId: string | null;
  /**
   * Tests chat turns started read-only, card id → turn id. They cannot write,
   * so they do not hold the queue. The turn id keeps an old turn's late close
   * from clearing the flag of the turn that replaced it.
   */
  readOnlyChats: Map<string, string>;
  initialized: boolean;
}

const g = globalThis as unknown as { __kanban_runQueue?: RunQueueState };

function queueState(): RunQueueState {
  if (!g.__kanban_runQueue) {
    g.__kanban_runQueue = {
      armed: false,
      pausedReason: null,
      consecutiveFailures: 0,
      advancing: false,
      inFlight: new Set(),
      readOnlyChats: new Map(),
      queueStartedCardId: null,
      initialized: false,
    };
  }
  const state = g.__kanban_runQueue;
  // A dev server keeps the object across reloads, from before the field.
  state.readOnlyChats ??= new Map();
  if (!state.initialized) {
    state.initialized = true;
    // Cards still queued from a previous session: say so, and wait for Resume
    // rather than letting the next Add to queue quietly start all of them.
    if (listQueueRows().length > 0) state.pausedReason = "Ideafy restarted";
  }
  return state;
}

export class QueueError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

// ============================================================================
// Rows
// ============================================================================

// The queue's reads and writes live in lib/card-ops/queue.ts, shared with the
// MCP's queue tools; these wrap them on the app's connection. Never call them
// from inside a drizzle db.transaction() block: the shared transaction opens
// its own BEGIN IMMEDIATE.

function listQueueRows(): QueueRow[] {
  return listSharedQueueRows(sqlite());
}

function getRow(cardId: string): QueueRow | undefined {
  return getQueueRow(sqlite(), cardId);
}

const displayIdOf = queueDisplayId;
const ineligibleReason = queueRowIneligibleReason;
const kindOf = queueKindOf;

// ============================================================================
// Order
// ============================================================================

/**
 * Puts `cardId` in the queue right behind `afterCardId`: `undefined` appends,
 * `null` moves it to the front. A card already queued is moved, not doubled.
 * `verifyScope` is what a queued pre-verify walks; a move without one keeps it.
 */
export function enqueueCard(cardId: string, afterCardId?: string | null, verifyScope?: VerifyScope): void {
  const result = enqueueQueueRow(sqlite(), cardId, afterCardId, verifyScope);
  if (!result.ok) throw new QueueError(result.message, result.reason === "not-found" ? 404 : 400);
}

/** Takes a card out of the queue and closes the gap. False if it was not queued. */
export function dequeueCard(cardId: string): boolean {
  return dequeueQueueRow(sqlite(), cardId);
}

/**
 * Empties the queue and disarms it. Only waiting cards go: the run the queue
 * waits behind keeps going, and a card between its Start and its first line
 * stays put. The queue is left without a pause reason, so the next Add to
 * queue starts it fresh, as it would after running dry. Returns the cleared
 * cards in order and whether the queue was running, for Undo.
 */
export function clearQueue(): { cleared: ClearedQueueCard[]; wasArmed: boolean } {
  const state = queueState();
  const wasArmed = state.armed;
  const cleared = clearQueueRows(sqlite(), state.inFlight);
  state.armed = false;
  return { cleared, wasArmed };
}

/**
 * Undo for clearQueue: puts the cards back in their old order, in front of
 * anything queued since, and re-arms the queue when it was running before. A
 * card that can no longer be queued — moved to Human Test, a run going on it
 * — is skipped and named, rather than dropped without a word.
 */
export function restoreQueue(
  cardIds: string[],
  resume: boolean
): { skipped: { cardId: string; displayId: string; reason: string }[] } {
  const { restored, skipped } = restoreQueueCards(sqlite(), cardIds);
  if (resume && restored.length > 0) resumeQueue();
  return { skipped };
}

// ============================================================================
// Shared-file warning
// ============================================================================

/**
 * Card ids with a code-writing run going right now: autonomous, quick fix, or
 * a Tests tab chat with write access. Evaluate and the other chat tabs are
 * read-only, so the queue does not wait for them.
 */
function runningCardIds(): Set<string> {
  const ids = new Set(queueState().inFlight);
  for (const p of getAllProcesses()) {
    if ((p.processType === "autonomous" || p.processType === "quick-fix") && p.status === "running") {
      ids.add(p.cardId);
    }
  }
  for (const id of testsChatCardIds()) ids.add(id);
  return ids;
}

/** Cards whose Tests tab chat is answering right now with every permission. */
function testsChatCardIds(): Set<string> {
  const ids = new Set<string>();
  const readOnly = queueState().readOnlyChats;
  for (const p of getAllProcesses()) {
    if (p.processType !== "chat" || p.sectionType !== "tests" || p.status !== "running") continue;
    if (readOnly.has(p.cardId)) continue;
    const row = getRow(p.cardId);
    if (row && isTestActionFor("tests", row.status)) ids.add(p.cardId);
  }
  return ids;
}

/**
 * The cards ahead of `cardId` — in the queue, or running now — whose plans
 * name a file this card's plan also names. Worktrees do not help here: every
 * queued card branches from main before the one ahead of it is merged, so
 * two cards on the same file meet again at merge time. The queue only makes
 * sure you hear about it before you walk away.
 *
 * Only runs that write code count, on either side: a pre-verify walks a
 * checklist and a plan run writes the plan, so neither leaves a diff to
 * meet at merge time.
 */
function overlapsFor(cardId: string, queue: QueueRow[], running: QueueRow[]): QueueOverlap[] {
  const self = queue.find((r) => r.id === cardId) ?? getRow(cardId);
  if (!self || kindOf(self) === "verify") return [];
  const mine = extractPlanFiles(self.solutionSummary);
  if (mine.length === 0) return [];

  const index = queue.findIndex((r) => r.id === cardId);
  const ahead = [
    ...running.filter((row) => writesCode(liveKindOf(row))),
    ...(index === -1 ? queue : queue.slice(0, index)).filter((row) => kindOf(row) !== "verify"),
  ];
  const seen = new Set<string>();
  const overlaps: QueueOverlap[] = [];
  for (const other of ahead) {
    if (other.id === cardId || seen.has(other.id)) continue;
    seen.add(other.id);
    const files = sharedPlanFiles(mine, extractPlanFiles(other.solutionSummary));
    if (files.length > 0) overlaps.push({ cardId: other.id, displayId: displayIdOf(other), files });
  }
  return overlaps;
}

function runningRows(): QueueRow[] {
  return Array.from(runningCardIds())
    .map((id) => getRow(id))
    .filter((row): row is QueueRow => !!row);
}

export function overlapsForCard(cardId: string): QueueOverlap[] {
  return overlapsFor(cardId, listQueueRows(), runningRows());
}

/** What the card's run does, or is doing: a quick fix, else the Start phase. */
function liveKindOf(row: QueueRow): LiveRunKind {
  if (row.processingType === "quick-fix") return "quick-fix";
  // A pre-verify's automatic fix, mid-chain on a Human Test card (IDE-459).
  if (row.processingType === "verify-fix") return "verify-fix";
  return detectPhase(row);
}

/** Runs that leave a code diff behind. */
function writesCode(kind: LiveRunKind): boolean {
  return kind === "implementation" || kind === "quick-fix" || kind === "retest" || kind === "verify-fix";
}

/**
 * The same call the run's start makes, so the popover shows what will happen.
 * A pre-verify goes to the card's active worktree whatever its branch choice
 * says; whether that folder is still on disk is setupWorktree's to check, and
 * so is whether the project is a git repo at all — this stays optimistic there.
 * Planning always runs in the project folder.
 */
function runsInWorktree(row: QueueRow, kind: LiveRunKind = liveKindOf(row)): boolean {
  const activeWorktree = !!row.gitWorktreePath && row.gitWorktreeStatus === "active";
  // A Tests chat, like a pre-verify, works in the card's active worktree.
  // The automatic fix runs where its pre-verify did.
  if (kind === "verify" || kind === "verify-fix" || kind === "tests-chat") return activeWorktree;
  if (kind === "planning") return false;
  const useWorktree = shouldUseWorktree(
    { useWorktree: row.useWorktree },
    { useWorktrees: row.projectUseWorktrees, mode: row.projectMode }
  );
  if (kind === "retest") return !!row.gitWorktreePath && (useWorktree || activeWorktree);
  // Implementation and quick fix both open one only for a numbered project card.
  return (useWorktree && !!row.projectId && row.taskNumber != null) || (kind === "implementation" && activeWorktree);
}

export interface RunConflict {
  conflictCardId: string;
  error: string;
}

/**
 * The live run that a manual Start, Pre-verify or Quick fix on `cardId` would
 * share a folder with, or null when it may go ahead. The queue keeps one run
 * at a time only for what it starts itself; this is the other half, so a
 * button pressed while the queue runs on main does not write next to it. A
 * run in its own worktree is left alone either way: parallel runs there were
 * fine before the queue and still are.
 *
 * Synchronous on purpose: the caller checks and marks itself in flight in the
 * same tick, so a second request cannot slip in between.
 */
function folderRun(row: QueueRow, kind: LiveRunKind = liveKindOf(row)) {
  return { ...row, kind, runsInWorktree: runsInWorktree(row, kind) };
}

function liveFolderRuns() {
  const chats = testsChatCardIds();
  // A card with both a run and a chat going: the chat is the one on main.
  return runningRows().map((row) => folderRun(row, chats.has(row.id) ? "tests-chat" : undefined));
}

export function runConflictFor(cardId: string, kind?: "quick-fix"): RunConflict | null {
  const self = getRow(cardId);
  if (!self) return null;
  const other = conflictingLiveRun(folderRun(self, kind ?? detectPhase(self)), liveFolderRuns());
  if (!other) return null;
  const what =
    other.kind === "tests-chat"
      ? `${displayIdOf(other)}'s Tests chat is working in the same folder.`
      : other.id === queueState().queueStartedCardId
        ? `${displayIdOf(other)} is running from the queue in the same folder.`
        : `${displayIdOf(other)} is running in the same folder.`;
  const then = kind === "quick-fix" ? "Wait for it to finish." : "Wait for it, or use Add to queue.";
  return { conflictCardId: other.id, error: `${what} ${then}` };
}

/**
 * Whether a Tests chat on `cardId` may edit this turn. Not while a live run
 * works in the same folder, and not while the armed queue has a card waiting
 * for that folder either: the queue goes first, and Pause is how you take the
 * folder back. A chat in its card's own worktree is never held back. Such a
 * turn still answers; it only loses the tools that write.
 */
export function testsChatWriteBlock(cardId: string): ChatWriteBlock | null {
  const self = getRow(cardId);
  if (!self || !isTestActionFor("tests", self.status)) return null;
  const chat = folderRun(self, "tests-chat");
  const live = conflictingLiveRun(chat, liveFolderRuns());
  const waiting = queueState().armed
    ? listQueueRows().find((row) => conflictingLiveRun(chat, [folderRun(row, kindOf(row))]))
    : undefined;

  if (live) {
    const name = displayIdOf(live);
    if (waiting) {
      return {
        conflictCardId: live.id,
        pausable: true,
        message: `Read-only: ${name} is running on main and the queue has more waiting. Pause the queue and let ${name} finish to let this chat edit.`,
      };
    }
    const who = live.kind === "tests-chat" ? `${name}'s Tests chat is working` : `${name} is running`;
    return {
      conflictCardId: live.id,
      pausable: false,
      message: `Read-only: ${who} on main. This chat can edit again once it finishes.`,
    };
  }
  if (waiting) {
    return {
      conflictCardId: waiting.id,
      pausable: true,
      message: `Read-only: the queue is running on main (${displayIdOf(waiting)} is next). Pause it to let this chat edit.`,
    };
  }
  return null;
}

/**
 * Without a worktree a run starts on top of whatever the run before it left
 * uncommitted, and Human Test then shows both cards' work as one. That only
 * bites when the run ahead also skipped its worktree, so the warning names
 * that card and stays quiet otherwise.
 */
export function worktreeWarningFor(cardId: string): string | null {
  const queue = listQueueRows();
  const self = queue.find((r) => r.id === cardId) ?? getRow(cardId);
  if (!self) return null;
  const index = queue.findIndex((r) => r.id === cardId);
  // A plan run leaves no diff behind to start on top of.
  const running = runningRows().filter((row) => liveKindOf(row) !== "planning");
  const ahead = [...running, ...(index === -1 ? queue : queue.slice(0, index))];
  const toRun = (row: QueueRow) => ({ ...row, runsInWorktree: runsInWorktree(row), kind: kindOf(row) });
  const other = sharedWorkingCopyWith(toRun(self), ahead.map(toRun));
  if (!other) return null;
  return kindOf(self) === "verify"
    ? `${displayIdOf(self)} will be tested on top of ${displayIdOf(other)}'s uncommitted changes.`
    : `${displayIdOf(self)} runs in the same working copy as ${displayIdOf(other)}: uncommitted changes will mix in Human Test.`;
}

// ============================================================================
// Snapshot
// ============================================================================

export function getQueueSnapshot(): QueueSnapshot {
  const state = queueState();
  const queue = listQueueRows();
  const running = runningRows();
  nudgeQueue(queue.length);
  const current = running.find((r) => r.id === state.queueStartedCardId) ?? running[0] ?? null;
  return {
    items: queue.map((row) => ({
      cardId: row.id,
      displayId: displayIdOf(row),
      title: row.title,
      overlaps: overlapsFor(row.id, queue, running),
      runsInWorktree: runsInWorktree(row),
      kind: kindOf(row),
      verifyScope: kindOf(row) === "verify" ? row.queueVerifyScope : null,
    })),
    armed: state.armed,
    pausedReason: state.pausedReason,
    running: current
      ? { cardId: current.id, displayId: displayIdOf(current), fromQueue: current.id === state.queueStartedCardId }
      : null,
  };
}

// ============================================================================
// Running
// ============================================================================

function pause(reason: string, cardId: string | null): string {
  const state = queueState();
  state.armed = false;
  state.pausedReason = reason;
  const row = cardId ? getRow(cardId) : undefined;
  recordActivity({
    type: "queue",
    cardId,
    projectId: row?.projectId ?? null,
    title: "Queue paused",
    summary: `${reason} · ${listQueueRows().length} waiting`,
    payload: { reason },
  });
  return reason;
}

/**
 * Adding a card starts the queue — the whole point is Start one card, queue
 * two more, walk away — unless it was paused for a reason. Then it stays
 * paused until someone presses Resume, having seen why. A reason only counts
 * while cards are still waiting behind it: once the queue ran dry, the next
 * card added is a fresh start, not a continuation of whatever stopped.
 */
export function armIfIdle(): void {
  const state = queueState();
  if (state.pausedReason && listQueueRows().length > 1) return;
  state.pausedReason = null;
  state.consecutiveFailures = 0;
  state.armed = true;
  scheduleAdvance();
}

export function resumeQueue(): void {
  const state = queueState();
  state.armed = true;
  state.pausedReason = null;
  state.consecutiveFailures = 0;
  scheduleAdvance();
}

export function pauseQueue(): void {
  const state = queueState();
  state.armed = false;
  state.pausedReason = "Paused by you";
}

/**
 * A terminal session can queue a card through the MCP, and nothing in this
 * process hears about it: no Add to queue press, no run ending. The app polls
 * the snapshot every 10 seconds, so the snapshot is where the queue looks for
 * work it was not told about. Only an armed, idle queue moves; a paused one
 * still waits for Resume, as it does after a restart.
 */
function nudgeQueue(waiting: number): void {
  const state = queueState();
  if (!state.armed || state.advancing || waiting === 0 || hasLiveRun()) return;
  scheduleAdvance();
}

function scheduleAdvance(): void {
  setImmediate(() => {
    advanceQueue().catch((error) => console.error("[run-queue] advance failed:", error));
  });
}

/**
 * Called by every Start run on its way out — the queue's own and manual ones
 * alike, since a manual run is what the queue was waiting behind. Returns the
 * pause reason when this outcome stopped the queue, so the caller can put it
 * in front of the run's error.
 *
 * A run that resolved moves the queue on even if its output carried a
 * warning: the card failing at its own work is the card's problem. A run that
 * rejected on a usage limit, a login or a missing CLI will take every card
 * behind it down the same way, so that pauses. So does a Stop, and so does a
 * second unexplained failure in a row.
 */
export function onRunFinished(args: { cardId: string; outcome: RunOutcome; error?: string | null }): string | null {
  const state = queueState();
  if (!state.armed) return null;
  if (args.outcome === "completed") {
    state.consecutiveFailures = 0;
    return null;
  }
  const row = getRow(args.cardId);
  const label = row ? displayIdOf(row) : "a run";
  if (args.outcome === "stopped") return pause(`you stopped ${label}`, args.cardId);

  const infra = infrastructureRunError(args.error);
  if (infra) return pause(infra, args.cardId);

  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= 2) return pause("two runs failed in a row", args.cardId);
  return null;
}

/**
 * Marks a Start or Quick fix run as in flight until the returned release is
 * called. The release schedules the next advance, which is how the queue
 * moves on.
 */
export function beginTrackedStart(cardId: string): () => void {
  const state = queueState();
  state.inFlight.add(cardId);
  return () => {
    state.inFlight.delete(cardId);
    if (state.queueStartedCardId === cardId) state.queueStartedCardId = null;
    scheduleAdvance();
  };
}

/** A Tests chat turn starting; a read-only one is kept from holding the queue. */
export function onTestsChatStarted(cardId: string, turnId: string, readOnly: boolean): void {
  const chats = queueState().readOnlyChats;
  if (readOnly) chats.set(cardId, turnId);
  else chats.delete(cardId);
}

/**
 * A Tests chat turn ended. One with write access held the queue while it
 * answered, like a manual run, but reports to nothing else, so the queue gets
 * its chance to move on here.
 */
export function onTestsChatEnded(cardId: string, turnId: string): void {
  const chats = queueState().readOnlyChats;
  if (chats.get(cardId) === turnId) chats.delete(cardId);
  scheduleAdvance();
}

function hasLiveRun(): boolean {
  return runningCardIds().size > 0;
}

/**
 * Starts the next queued card if nothing else is running. One run at a time is
 * the rule the queue exists to keep, so a manual run going on some other card
 * holds the queue too; it moves on when that run ends.
 *
 * The next card is checked again right before it starts. It may have waited
 * an hour: its plan deleted, moved to Completed by hand, its branch rolled
 * back, or trashed. Those leave the queue with a line in the bell rather than
 * silently.
 */
export async function advanceQueue(): Promise<void> {
  const state = queueState();
  if (!state.armed || state.advancing || hasLiveRun()) return;
  state.advancing = true;
  try {
    // Imported lazily: start-card-run reports back to this module, and a
    // static import both ways is a cycle.
    const { startCardRun } = await import("./start-card-run");
    if (!state.armed || hasLiveRun()) return;

    for (;;) {
      const next = listQueueRows()[0];
      if (!next) return;

      const reason = ineligibleReason(next);
      if (reason) {
        dequeueCard(next.id);
        recordActivity({
          type: "queue",
          cardId: next.id,
          projectId: next.projectId,
          title: "Dropped from queue",
          summary: `${displayIdOf(next)} was skipped: ${reason}`,
          payload: { reason },
        });
        continue;
      }

      state.queueStartedCardId = next.id;
      // Not awaited: the run takes minutes and reports back through
      // onRunFinished / the release in beginTrackedStart. startCardRun marks
      // itself in flight and dequeues the card before its first await, so
      // the next advance already sees both.
      startCardRun(next.id, { verifyScope: next.queueVerifyScope ?? undefined }).catch((error) => {
        console.error(`[run-queue] start of ${next.id} threw:`, error);
      });
      return;
    }
  } finally {
    state.advancing = false;
  }
}
