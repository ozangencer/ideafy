import { parseAiVerdict, type AiVerdictValue } from "../opinion-markers";
import { runChanges, type SqlDb } from "./db";

export type SaveOpinionResult =
  | { ok: true; verdict: AiVerdictValue | null }
  | { ok: false; reason: "not-found" };

/**
 * Writes an AI Opinion and its verdict. The verdict comes from the Summary
 * Verdict the opinion itself names (lib/opinion-markers.ts) — the same reader
 * Evaluate and Apply use — so a Maybe written in a terminal lands as `maybe`
 * just like one written in the app. `fallbackVerdict`, what the caller claims,
 * counts only when the text names no verdict.
 *
 * `source` is the opinion as written (markdown); `html` is what gets stored.
 */
export function saveOpinion(
  db: SqlDb,
  args: {
    id: string;
    html: string;
    source: string;
    fallbackVerdict?: AiVerdictValue | null;
    now: string;
  }
): SaveOpinionResult {
  const verdict = parseAiVerdict(args.source) ?? args.fallbackVerdict ?? null;
  const { changes } = runChanges(
    db,
    `UPDATE cards SET ai_opinion = ?, ai_verdict = ?, updated_at = ? WHERE id = ?`,
    args.html,
    verdict,
    args.now,
    args.id
  );
  return changes === 0 ? { ok: false, reason: "not-found" } : { ok: true, verdict };
}
