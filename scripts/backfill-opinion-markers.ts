/**
 * Re-read the verdict and score of every card that already has an AI Opinion.
 *
 *   npx tsx scripts/backfill-opinion-markers.ts [--db <path>] [--apply]
 *
 * Dry-run by default: prints how many cards would change and how (e.g.
 * "verdict positive → maybe: 12", "score null → 8: 70"), then the cards
 * themselves. --apply writes them.
 *
 * Before IDE-400 each write path read the verdict its own way: Evaluate split
 * a Maybe by score (6+ positive), Apply left it null (and null drew a green
 * tick), and Turkish opinions like "Belki … notlarını" read as negative off the
 * "no" in "notlarını". Before IDE-403 the X/10 score was stored nowhere. This
 * runs the one reader all paths now share (lib/opinion-markers.ts) over the
 * stored HTML and fixes what differs.
 *
 * Writes ai_verdict and ai_score and nothing else — not priority or
 * complexity, which may have been picked by hand since the opinion was
 * written, and not updated_at, which card age and Focus read as activity; a
 * re-read verdict is not work done on the card. A field the opinion does not
 * name is left alone.
 *
 * ai_score arrives with migration 0021, which the app runs on start: start
 * the app once before running this.
 *
 * Uses node:sqlite so the root better-sqlite3 binary's ABI (Electron after
 * `npm run pack`) does not matter.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import * as markersNs from "../lib/opinion-markers";

const { parseOpinionMarkers } =
  (markersNs as unknown as { default?: typeof markersNs }).default ?? markersNs;

function resolveDbPath(explicit: string | undefined): string {
  if (explicit) return explicit;
  const dir =
    process.env.IDEAFY_USER_DATA ?? path.join(os.homedir(), "Library", "Application Support", "ideafy");
  const target = path.join(dir, "kanban.db");
  if (fs.existsSync(target)) return target;
  const legacy = path.join(process.cwd(), "data", "kanban.db");
  if (fs.existsSync(legacy)) return legacy;
  throw new Error(`No kanban.db found at ${target} or ${legacy}`);
}

const args = process.argv.slice(2);
const dbFlag = args.indexOf("--db");
const apply = args.includes("--apply");
const dbPath = resolveDbPath(dbFlag >= 0 ? args[dbFlag + 1] : undefined);

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const db = new DatabaseSync(dbPath);

const columns = db.prepare(`PRAGMA table_info(cards)`).all() as unknown as Array<{ name: string }>;
if (!columns.some((column) => column.name === "ai_score")) {
  console.error(`${dbPath} has no cards.ai_score yet — start the Ideafy app once so it runs migration 0021.`);
  process.exit(1);
}

type Row = {
  id: string;
  display: string;
  title: string;
  ai_opinion: string;
  ai_verdict: string | null;
  ai_score: number | null;
};
const rows = db
  .prepare(
    `SELECT c.id, COALESCE(p.id_prefix || '-' || c.task_number, c.id) AS display, c.title,
            c.ai_opinion, c.ai_verdict, c.ai_score
       FROM cards c LEFT JOIN projects p ON p.id = c.project_id
      WHERE c.ai_opinion IS NOT NULL AND c.ai_opinion != ''`
  )
  .all() as unknown as Row[];

type Change = { row: Row; verdict: string | null; score: number | null };
const changes: Change[] = [];
let unreadable = 0;
for (const row of rows) {
  const markers = parseOpinionMarkers(row.ai_opinion);
  if (!markers.verdict && markers.score === null) {
    unreadable++;
    continue;
  }
  const storedScore = row.ai_score === null ? null : Number(row.ai_score);
  const verdict = markers.verdict && markers.verdict !== row.ai_verdict ? markers.verdict : null;
  const score = markers.score !== null && markers.score !== storedScore ? markers.score : null;
  if (verdict || score !== null) changes.push({ row, verdict, score });
}

const tally = new Map<string, number>();
const bump = (key: string) => tally.set(key, (tally.get(key) ?? 0) + 1);
for (const { row, verdict, score } of changes) {
  if (verdict) bump(`verdict ${row.ai_verdict ?? "null"} → ${verdict}`);
  if (score !== null) bump(row.ai_score === null ? "score null → set" : "score changed");
}

console.log(`${dbPath}`);
console.log(`${rows.length} cards with an opinion · ${changes.length} to change · ${unreadable} unreadable (left alone)`);
for (const [key, count] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${key}: ${count}`);
for (const { row, verdict, score } of changes) {
  const parts = [
    verdict && `verdict ${row.ai_verdict ?? "null"} → ${verdict}`,
    score !== null && `score ${row.ai_score ?? "null"} → ${score}/10`,
  ].filter(Boolean);
  console.log(`  ${row.display}  ${parts.join(" · ")}  ${row.title}`);
}

if (!apply) {
  console.log("\nDry run. Rerun with --apply to write.");
} else {
  const update = db.prepare(
    `UPDATE cards SET ai_verdict = COALESCE(?, ai_verdict), ai_score = COALESCE(?, ai_score) WHERE id = ?`
  );
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const { row, verdict, score } of changes) update.run(verdict, score, row.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  console.log(`\nWrote ${changes.length} cards.`);
}
db.close();
