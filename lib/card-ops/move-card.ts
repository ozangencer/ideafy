import { COLUMNS, type Status } from "../types";
import { getRow, runChanges, transaction, type SqlDb } from "./db";

const STATUSES: readonly string[] = COLUMNS.map((column) => column.id);

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && STATUSES.includes(value);
}

/**
 * The completed_at a card should carry after a status change. Entering
 * Completed stamps `now`, leaving clears it, anything else (staying put, or a
 * move between two other columns) keeps what is there — so a card moved to
 * Completed a second time keeps the day it was actually finished.
 *
 * The app's PUT route and the MCP's update_card call this inside their own
 * writes; moveCard below calls it for a plain column move.
 */
export function completedAtFor(
  oldStatus: string,
  newStatus: string,
  current: string | null,
  now: string
): string | null {
  if (newStatus === "completed" && oldStatus !== "completed") return now;
  if (newStatus !== "completed" && oldStatus === "completed") return null;
  return current;
}

export type MoveCardResult =
  | { ok: true; changed: boolean; from: Status; to: Status; completedAt: string | null }
  | { ok: false; reason: "not-found" | "invalid-status" };

/**
 * Moves a card to another column: status, updated_at and completed_at in one
 * UPDATE. queue_position and group_order are cleared by the database's own
 * triggers, so the app and the MCP get those for free.
 *
 * Assumes the current schema. The MCP server checks its database can take the
 * write (mcp-server/schema-caps.ts) before calling this.
 */
export function moveCard(db: SqlDb, id: string, status: string, now: string): MoveCardResult {
  if (!isStatus(status)) return { ok: false, reason: "invalid-status" };

  return transaction(db, () => {
    const row = getRow<{ status: Status; completed_at: string | null }>(
      db,
      `SELECT status, completed_at FROM cards WHERE id = ?`,
      id
    );
    if (!row) return { ok: false, reason: "not-found" } as const;

    const completedAt = completedAtFor(row.status, status, row.completed_at, now);
    runChanges(
      db,
      `UPDATE cards SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
      status,
      now,
      completedAt,
      id
    );
    return { ok: true, changed: row.status !== status, from: row.status, to: status, completedAt } as const;
  });
}
