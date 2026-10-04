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

/** completed_at for a card created straight into `status`. */
export function completedAtOnCreate(status: string, now: string): string | null {
  return completedAtFor("", status, null, now);
}

/**
 * Where saving a plan sends a card. A plan is the "ready to build" moment, so
 * a card still waiting for one (Ideation, Backlog, Bugs) moves to In
 * Progress. Anywhere else the plan is saved and the card stays put: a card in
 * Human Test or Completed is not bounced back to In Progress by a revised
 * plan. null = no move. The app's Apply and the MCP's save_plan both read it.
 */
export function statusAfterPlan(current: string): Status | null {
  return current === "ideation" || current === "backlog" || current === "bugs" ? "progress" : null;
}

/**
 * Where saving test scenarios sends a card: Human Test, unless it is already
 * there or finished. A checklist recorded on a Completed or Withdrawn card
 * (results ticked off after the fact) keeps it where it is. null = no move.
 */
export function statusAfterTests(current: string): Status | null {
  return current === "test" || current === "completed" || current === "withdrawn" ? null : "test";
}

export type MoveCardResult =
  | { ok: true; changed: boolean; from: Status; to: Status; completedAt: string | null }
  | { ok: false; reason: "not-found" | "invalid-status" };

/**
 * Moves a card to another column: status, updated_at and completed_at in one
 * UPDATE. queue_position is cleared by the database's own trigger (0018) when
 * the card enters Human Test, Completed, Withdrawn or Ideation, so the app and
 * the MCP get that for free. group_order is untouched: its trigger (0016)
 * fires on a group change, not a column move.
 *
 * Every MCP tool that changes a card's column goes through this (or, for
 * update_card's combined write, completedAtFor). __tests__/status-writes.test.ts
 * fails the build if an MCP file writes `status` with its own SQL.
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
