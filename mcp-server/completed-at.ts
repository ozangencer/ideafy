import type { Db } from "./db.js";
import { hasColumn } from "./output-paths.js";

// The app's PUT /api/cards/[id] stamps completed_at when a card enters
// Completed and clears it when it leaves. move_card and update_card used to
// write status alone, so a card finished from a terminal never got a date:
// the Completed column sorted it last, "completed today" skipped it, and the
// scratch sweep fell back to updated_at.

/**
 * The SET fragment that keeps completed_at in step with a status change.
 * SQLite evaluates every SET expression against the row as it was before the
 * UPDATE, so `status` here is the old value: entering Completed stamps `now`,
 * leaving clears it, staying put (or moving between two other columns) keeps
 * whatever is there. Returns null on a database without the column.
 */
export function completedAtAssignment(
  db: Db,
  newStatus: string,
  now: string
): { sql: string; params: unknown[] } | null {
  if (!hasColumn(db, "cards", "completed_at")) return null;
  return {
    sql: `completed_at = CASE
      WHEN ? = 'completed' AND status <> 'completed' THEN ?
      WHEN ? <> 'completed' AND status = 'completed' THEN NULL
      ELSE completed_at END`,
    params: [newStatus, now, newStatus],
  };
}
