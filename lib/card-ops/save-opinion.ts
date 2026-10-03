import { parseOpinionMarkers, type AiVerdictValue, type MarkerLevel } from "../opinion-markers";
import { getRow, runChanges, type SqlDb } from "./db";

/** What the card holds after the save — read back from the row, not assumed. */
export interface SavedOpinionFields {
  verdict: AiVerdictValue | null;
  score: number | null;
  priority: MarkerLevel | null;
  complexity: MarkerLevel | null;
}

export type SaveOpinionResult =
  | ({ ok: true } & SavedOpinionFields)
  | { ok: false; reason: "not-found" };

/**
 * Writes an AI Opinion and the fields its markers name: verdict, score,
 * priority and complexity (lib/opinion-markers.ts). Evaluate, Apply and the
 * MCP save_opinion all write through here, so the same opinion lands as the
 * same card whether it was written in the app or in a terminal.
 *
 * - `source` is the opinion as written (markdown); `html` is what gets stored.
 * - `replace` (default): the opinion is the whole evaluation, so a verdict or
 *   score it does not name is cleared. `fallbackVerdict`, what the caller
 *   claims, counts only when the text names no verdict.
 * - `append`: `source` is only the added part; a verdict or score it does not
 *   name keeps the card's current one.
 * - Priority and complexity are written only when named — both columns are
 *   NOT NULL and may have been picked by hand.
 */
export function saveOpinion(
  db: SqlDb,
  args: {
    id: string;
    html: string;
    source: string;
    fallbackVerdict?: AiVerdictValue | null;
    mode?: "replace" | "append";
    now: string;
  }
): SaveOpinionResult {
  const markers = parseOpinionMarkers(args.source);
  const verdict = markers.verdict ?? args.fallbackVerdict ?? null;
  const keep = args.mode === "append";

  const { changes } = runChanges(
    db,
    `UPDATE cards SET
       ai_opinion = ?,
       ai_verdict = ${keep ? "COALESCE(?, ai_verdict)" : "?"},
       ai_score = ${keep ? "COALESCE(?, ai_score)" : "?"},
       priority = COALESCE(?, priority),
       complexity = COALESCE(?, complexity),
       updated_at = ?
     WHERE id = ?`,
    args.html,
    verdict,
    markers.score,
    markers.priority,
    markers.complexity,
    args.now,
    args.id
  );
  if (changes === 0) return { ok: false, reason: "not-found" };

  const row = getRow<{
    verdict: AiVerdictValue | null;
    score: number | null;
    priority: MarkerLevel | null;
    complexity: MarkerLevel | null;
  }>(
    db,
    `SELECT ai_verdict AS verdict, ai_score AS score, priority, complexity FROM cards WHERE id = ?`,
    args.id
  );
  return {
    ok: true,
    verdict: row?.verdict ?? null,
    score: row?.score === null || row?.score === undefined ? null : Number(row.score),
    priority: row?.priority ?? null,
    complexity: row?.complexity ?? null,
  };
}
