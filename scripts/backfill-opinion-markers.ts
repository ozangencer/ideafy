/**
 * Re-read the verdict of every card that already has an AI Opinion.
 *
 *   npx tsx scripts/backfill-opinion-markers.ts [--db <path>] [--apply]
 *
 * Dry-run by default: prints how many cards would change and how (e.g.
 * "positive → maybe: 12"), then the cards themselves. --apply writes them.
 *
 * Before IDE-400 each write path read the verdict its own way: Evaluate split
 * a Maybe by score (6+ positive), Apply left it null (and null drew a green
 * tick), and Turkish opinions like "Belki … notlarını" read as negative off the
 * "no" in "notlarını". This runs the one reader all paths now share
 * (lib/opinion-markers.ts) over the stored HTML and fixes what differs.
 *
 * Writes ai_verdict and nothing else — not updated_at, which card age and
 * Focus read as activity; a re-read verdict is not work done on the card.
 * Cards whose opinion names no verdict are left alone.
 *
 * Uses node:sqlite so the root better-sqlite3 binary's ABI (Electron after
 * `npm run pack`) does not matter.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import * as markersNs from "../lib/opinion-markers";

const { parseAiVerdict } =
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

type Row = { id: string; display: string; title: string; ai_opinion: string; ai_verdict: string | null };
const rows = db
  .prepare(
    `SELECT c.id, COALESCE(p.id_prefix || '-' || c.task_number, c.id) AS display, c.title,
            c.ai_opinion, c.ai_verdict
       FROM cards c LEFT JOIN projects p ON p.id = c.project_id
      WHERE c.ai_opinion IS NOT NULL AND c.ai_opinion != ''`
  )
  .all() as unknown as Row[];

const changes: { row: Row; next: string }[] = [];
let unreadable = 0;
for (const row of rows) {
  const next = parseAiVerdict(row.ai_opinion);
  if (!next) {
    unreadable++;
    continue;
  }
  if (next !== row.ai_verdict) changes.push({ row, next });
}

const tally = new Map<string, number>();
for (const { row, next } of changes) {
  const key = `${row.ai_verdict ?? "null"} → ${next}`;
  tally.set(key, (tally.get(key) ?? 0) + 1);
}

console.log(`${dbPath}`);
console.log(`${rows.length} cards with an opinion · ${changes.length} to change · ${unreadable} unreadable (left alone)`);
for (const [key, count] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${key}: ${count}`);
for (const { row, next } of changes) {
  console.log(`  ${row.display}  ${row.ai_verdict ?? "null"} → ${next}  ${row.title}`);
}

if (!apply) {
  console.log("\nDry run. Rerun with --apply to write.");
} else {
  const update = db.prepare(`UPDATE cards SET ai_verdict = ? WHERE id = ?`);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const { row, next } of changes) update.run(next, row.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  console.log(`\nWrote ${changes.length} verdicts.`);
}
db.close();
