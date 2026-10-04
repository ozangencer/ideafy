import { compareByQueuePosition, queueIneligibleReason, type QueueRunKind } from "../card-queue";
import { placeAfter } from "../chain-order";
import { detectPhase } from "../prompts/phase";
import { stripHtml } from "../prompts/utils";
import { parseTestProgress } from "../test-progress";
import { shouldUseWorktree } from "../workspace";
import { allRows, getRow, transaction, type SqlDb } from "./db";

// The run queue's order, as both the app and the MCP server read and write it.
//
// The order lives on the cards (`queue_position`). Whether the queue is
// running does not: that sits in the app's memory, in
// lib/autonomous-run/run-queue.ts, which wraps these and keeps its armed
// state in step. A terminal session only ever changes the order; the app
// decides when a queued card starts.
//
// Every write reads the order it rewrites inside the same transaction, so the
// app and a terminal writing at once are put one after the other by SQLite
// rather than each rewriting the order it read a moment before. `updated_at`
// is left alone throughout: queueing is not work on the card, and the Stale
// row reads it.

/** A card as the queue reads it: enough to judge it, place it and name it. */
export interface QueueRow {
  id: string;
  title: string;
  status: string;
  description: string;
  solutionSummary: string;
  testScenarios: string;
  processingType: string | null;
  queuePosition: number | null;
  taskNumber: number | null;
  useWorktree: boolean | null;
  gitBranchStatus: string | null;
  gitWorktreePath: string | null;
  gitWorktreeStatus: string | null;
  projectId: string | null;
  idPrefix: string | null;
  projectMode: string | null;
  projectUseWorktrees: boolean | null;
}

const ROW_SELECT = `
  SELECT c.id, c.title, c.status, c.description,
         c.solution_summary AS solutionSummary,
         c.test_scenarios AS testScenarios,
         c.processing_type AS processingType,
         c.queue_position AS queuePosition,
         c.task_number AS taskNumber,
         c.use_worktree AS useWorktree,
         c.git_branch_status AS gitBranchStatus,
         c.git_worktree_path AS gitWorktreePath,
         c.git_worktree_status AS gitWorktreeStatus,
         c.project_id AS projectId,
         p.id_prefix AS idPrefix,
         p.mode AS projectMode,
         p.use_worktrees AS projectUseWorktrees
  FROM cards c LEFT JOIN projects p ON p.id = c.project_id`;

type RawRow = Omit<QueueRow, "useWorktree" | "projectUseWorktrees"> & {
  useWorktree: number | null;
  projectUseWorktrees: number | null;
};

// SQLite hands booleans back as 0/1; drizzle's boolean mode used to turn them.
function toQueueRow(raw: RawRow): QueueRow {
  return {
    ...raw,
    useWorktree: raw.useWorktree === null ? null : !!raw.useWorktree,
    projectUseWorktrees: raw.projectUseWorktrees === null ? null : !!raw.projectUseWorktrees,
  };
}

/** Every queued card, in run order. Positions may have gaps; read rank from the order. */
export function listQueueRows(db: SqlDb): QueueRow[] {
  return allRows<RawRow>(db, `${ROW_SELECT} WHERE c.queue_position IS NOT NULL`)
    .map(toQueueRow)
    .sort(compareByQueuePosition);
}

export function getQueueRow(db: SqlDb, cardId: string): QueueRow | undefined {
  const raw = getRow<RawRow>(db, `${ROW_SELECT} WHERE c.id = ?`, cardId);
  return raw ? toQueueRow(raw) : undefined;
}

export function queueDisplayId(row: Pick<QueueRow, "idPrefix" | "taskNumber" | "title">): string {
  return row.idPrefix && row.taskNumber != null ? `${row.idPrefix}-${row.taskNumber}` : row.title;
}

/**
 * Why this card cannot wait in the queue, or null. Only what the database
 * shows: the app also knows about a run between its Start and its first line,
 * and checks that on its own side.
 */
export function queueRowIneligibleReason(row: QueueRow): string | null {
  const core = parseTestProgress(row.testScenarios ?? "")?.core;
  const reason = queueIneligibleReason({
    status: row.status,
    hasDescription: stripHtml(row.description ?? "") !== "",
    phase: detectPhase(row),
    processingType: row.processingType,
    projectMode: row.projectMode,
    hasCoreFlow: !!core,
    gitBranchStatus: row.gitBranchStatus,
  });
  if (reason) return reason;
  // A pre-verify skips ticked core items, so a fully ticked core flow leaves
  // it nothing to run. Same rule as the board's Pre-verify button.
  if (row.status === "test" && core && core.checked >= core.total) return "its core flow is already ticked";
  return null;
}

export function queueKindOf(row: QueueRow): QueueRunKind {
  return detectPhase(row) === "verify" ? "verify" : "implementation";
}

/**
 * Whether a queued card's run lands in a worktree, as its start would decide
 * it: a pre-verify walks the checklist in the card's active worktree, an
 * implementation opens one for a numbered project card that wants one. The
 * app's snapshot answers the same for these two kinds.
 */
export function queuedRunsInWorktree(row: QueueRow): boolean {
  const activeWorktree = !!row.gitWorktreePath && row.gitWorktreeStatus === "active";
  if (queueKindOf(row) === "verify") return activeWorktree;
  const useWorktree = shouldUseWorktree(
    { useWorktree: row.useWorktree },
    { useWorktrees: row.projectUseWorktrees, mode: row.projectMode }
  );
  return (useWorktree && !!row.projectId && row.taskNumber != null) || activeWorktree;
}

/**
 * Rewrites the queue as 1..N in the given order and clears `removed`. Call
 * inside the transaction that read the order.
 */
function writeQueueOrder(db: SqlDb, ids: string[], removed: string[] = []): void {
  const place = db.prepare(`UPDATE cards SET queue_position = ? WHERE id = ?`);
  ids.forEach((id, index) => place.run(index + 1, id));
  const unqueue = db.prepare(`UPDATE cards SET queue_position = NULL WHERE id = ?`);
  for (const id of removed) unqueue.run(id);
}

export type EnqueueResult =
  | { ok: true; row: QueueRow; rank: number; moved: boolean }
  | {
      ok: false;
      reason: "not-found" | "ineligible" | "after-not-queued" | "after-self";
      message: string;
    };

/**
 * Puts `cardId` in the queue right behind `afterCardId`: `undefined` appends,
 * `null` moves it to the front. A card already queued is moved, not doubled.
 * Refusals come back as `{ ok: false }` with a message fit to show as is.
 */
export function enqueueCard(db: SqlDb, cardId: string, afterCardId?: string | null): EnqueueResult {
  if (afterCardId === cardId) {
    return { ok: false, reason: "after-self", message: "A card cannot be placed after itself" };
  }
  return transaction(db, (): EnqueueResult => {
    const row = getQueueRow(db, cardId);
    if (!row) return { ok: false, reason: "not-found", message: "Card not found" };
    const ineligible = queueRowIneligibleReason(row);
    if (ineligible) {
      return { ok: false, reason: "ineligible", message: `Cannot queue ${queueDisplayId(row)}: ${ineligible}` };
    }

    const members = listQueueRows(db);
    const others = members.filter((m) => m.id !== cardId);
    if (afterCardId && !others.some((m) => m.id === afterCardId)) {
      return { ok: false, reason: "after-not-queued", message: "afterCardId is not in the queue" };
    }
    const after = afterCardId === undefined ? others[others.length - 1]?.id ?? null : afterCardId;
    const moved = members.length !== others.length;
    const chainShaped = members.map((m) => ({ id: m.id, groupOrder: m.queuePosition, taskNumber: m.taskNumber }));
    if (!moved) chainShaped.push({ id: cardId, groupOrder: null, taskNumber: row.taskNumber });
    const order = placeAfter(chainShaped, cardId, after);
    writeQueueOrder(db, order);
    return { ok: true, row, rank: order.indexOf(cardId) + 1, moved };
  });
}

/** Takes a card out of the queue and closes the gap. False if it was not queued. */
export function dequeueCard(db: SqlDb, cardId: string): boolean {
  return transaction(db, () => {
    const members = listQueueRows(db);
    if (!members.some((m) => m.id === cardId)) return false;
    writeQueueOrder(
      db,
      members.filter((m) => m.id !== cardId).map((m) => m.id),
      [cardId]
    );
    return true;
  });
}

/** A card Undo could not put back, and why. */
export interface SkippedQueueCard {
  cardId: string;
  displayId: string;
  reason: string;
}

/**
 * Undo for a clear: puts the cards back in their old order, in front of
 * anything queued since. A card that can no longer be queued is skipped and
 * named, rather than dropped without a word.
 */
export function restoreQueueCards(
  db: SqlDb,
  cardIds: string[]
): { restored: string[]; skipped: SkippedQueueCard[] } {
  return transaction(db, () => {
    const members = listQueueRows(db);
    const queued = new Set(members.map((m) => m.id));
    const restored: string[] = [];
    const skipped: SkippedQueueCard[] = [];
    for (const cardId of new Set(cardIds)) {
      // Queued again since: it moves back to its old place with the others.
      if (queued.has(cardId)) {
        restored.push(cardId);
        continue;
      }
      const row = getQueueRow(db, cardId);
      const reason = row ? queueRowIneligibleReason(row) : "it was deleted";
      if (reason) skipped.push({ cardId, displayId: row ? queueDisplayId(row) : cardId, reason });
      else restored.push(cardId);
    }
    const back = new Set(restored);
    writeQueueOrder(db, [...restored, ...members.filter((m) => !back.has(m.id)).map((m) => m.id)]);
    return { restored, skipped };
  });
}

/** A card Clear took out of the queue, in the order it was waiting. */
export interface ClearedQueueCard {
  cardId: string;
  displayId: string;
}

/**
 * Takes every waiting card out of the queue, in one transaction, and returns
 * them in run order so the caller can put them back. `keep` is left queued:
 * the app passes the cards whose run is starting this very moment. A run that
 * is already going is not in the queue and is not touched.
 */
export function clearQueue(db: SqlDb, keep: ReadonlySet<string> = new Set()): ClearedQueueCard[] {
  return transaction(db, () => {
    const rows = allRows<{
      id: string;
      title: string;
      queuePosition: number | null;
      taskNumber: number | null;
      idPrefix: string | null;
    }>(
      db,
      `SELECT c.id, c.title, c.queue_position AS queuePosition, c.task_number AS taskNumber,
              p.id_prefix AS idPrefix
       FROM cards c LEFT JOIN projects p ON p.id = c.project_id
       WHERE c.queue_position IS NOT NULL`
    ).sort(compareByQueuePosition);

    const cleared = rows.filter((row) => !keep.has(row.id));
    const unqueue = db.prepare(`UPDATE cards SET queue_position = NULL WHERE id = ?`);
    for (const row of cleared) unqueue.run(row.id);
    return cleared.map((row) => ({ cardId: row.id, displayId: queueDisplayId(row) }));
  });
}
