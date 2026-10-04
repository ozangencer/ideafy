import { compareByQueuePosition } from "../card-queue";
import { allRows, transaction, type SqlDb } from "./db";

// The run queue's order, as both the app and the MCP server write it.
//
// The order lives on the cards (`queue_position`). Whether the queue is
// running does not: that sits in the app's memory, in
// lib/autonomous-run/run-queue.ts, which wraps these and keeps its armed
// state in step. Clearing is the first queue write to move in here; adding,
// removing and reordering one card still go through run-queue.ts until they
// follow.

/** A card Clear took out of the queue, in the order it was waiting. */
export interface ClearedQueueCard {
  cardId: string;
  displayId: string;
}

/**
 * Takes every waiting card out of the queue, in one transaction, and returns
 * them in run order so the caller can put them back. `keep` is left queued:
 * the app passes the cards whose run is starting this very moment. A run that
 * is already going is not in the queue and is not touched. `updated_at` is
 * left alone, as for every queue write: queueing is not work on the card.
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
    return cleared.map((row) => ({
      cardId: row.id,
      displayId: row.idPrefix && row.taskNumber != null ? `${row.idPrefix}-${row.taskNumber}` : row.title,
    }));
  });
}
