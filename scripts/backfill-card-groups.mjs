#!/usr/bin/env node
/**
 * One-shot migration from the old convention to the new column.
 *
 * Chains used to be encoded in the title — "[LOOP-01] WP1a — Loop runner…".
 * That made grouping depend on text: fix a typo in a title and the card falls
 * out of its chain, write [Loop-02] and it never joins one, and every card
 * pays ~10 characters of an already-clipped title for the privilege. This
 * script reads the prefixes one last time, turns them into real card_groups
 * rows, points cards at them and strips the prefix from the titles.
 *
 * Run it once, after the 0008 migration has been applied:
 *   node scripts/backfill-card-groups.mjs [--dry-run]
 *
 * Group names start out equal to their code; rename them afterwards (the card
 * face shows the code, the group row shows the name).
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PREFIX = /^\[([A-Z][A-Z0-9]*)-(\d+)\]\s*/;

function resolveDbPath() {
  const dir =
    process.env.IDEAFY_USER_DATA ??
    path.join(os.homedir(), "Library", "Application Support", "ideafy");
  const target = path.join(dir, "kanban.db");
  if (fs.existsSync(target)) return target;

  const legacy = path.join(process.cwd(), "data", "kanban.db");
  if (fs.existsSync(legacy)) return legacy;

  throw new Error(`No kanban.db found at ${target} or ${legacy}`);
}

const dryRun = process.argv.includes("--dry-run");
const dbPath = resolveDbPath();
const db = new Database(dbPath);
db.pragma("busy_timeout = 5000");

const hasGroups = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='card_groups'`)
  .get();
if (!hasGroups) {
  console.error(
    "card_groups table is missing — start the app once so the 0008 migration runs, then re-run this script."
  );
  process.exit(1);
}

const cards = db
  .prepare(`SELECT id, title, project_id, group_id FROM cards ORDER BY task_number`)
  .all();

/** code -> { projectId, cards: [{id, title, strippedTitle}] } */
const byCode = new Map();
for (const card of cards) {
  const match = PREFIX.exec(card.title);
  if (!match) continue;
  const code = match[1];
  const strippedTitle = card.title.slice(match[0].length).trim();
  if (!strippedTitle) {
    console.warn(`  ! ${card.id}: title is only the prefix, leaving it alone`);
    continue;
  }
  if (!byCode.has(code)) byCode.set(code, { projectId: card.project_id, cards: [] });
  byCode.get(code).cards.push({ ...card, strippedTitle });
}

if (byCode.size === 0) {
  console.log("No [CODE-NN] prefixes found — nothing to migrate.");
  process.exit(0);
}

// A single card carrying a prefix is not a chain; folding it would cost a row
// and save nothing. Leave those titles as they are rather than inventing a
// group of one.
const chains = [...byCode.entries()].filter(([, entry]) => entry.cards.length > 1);
const singletons = [...byCode.entries()].filter(([, entry]) => entry.cards.length === 1);

for (const [code] of singletons) {
  console.log(`- ${code}: only 1 card, skipped (a chain of one is not a chain)`);
}

const now = new Date().toISOString();
const existingByCode = new Map(
  db.prepare(`SELECT id, code FROM card_groups`).all().map((row) => [row.code, row.id])
);

const insertGroup = db.prepare(
  `INSERT INTO card_groups (id, project_id, code, name, color, created_at)
   VALUES (?, ?, ?, ?, NULL, ?)`
);
const updateCard = db.prepare(
  `UPDATE cards SET group_id = ?, title = ?, updated_at = ? WHERE id = ?`
);

const apply = db.transaction(() => {
  for (const [code, entry] of chains) {
    let groupId = existingByCode.get(code);
    if (groupId) {
      console.log(`- ${code}: group already exists, reusing it`);
    } else {
      groupId = randomUUID();
      // name starts as the code; the real name is a rename away.
      insertGroup.run(groupId, entry.projectId, code, code, now);
      console.log(`+ ${code}: created group (${entry.cards.length} cards)`);
    }
    for (const card of entry.cards) {
      updateCard.run(groupId, card.strippedTitle, now, card.id);
      console.log(`    ${card.title}  ->  ${card.strippedTitle}`);
    }
  }
});

if (dryRun) {
  console.log("\n--dry-run: nothing written. Re-run without the flag to apply.");
  for (const [code, entry] of chains) {
    console.log(`+ ${code} (${entry.cards.length} cards)`);
    for (const card of entry.cards) {
      console.log(`    ${card.title}  ->  ${card.strippedTitle}`);
    }
  }
  process.exit(0);
}

apply();

const movedCards = chains.reduce((sum, [, entry]) => sum + entry.cards.length, 0);
console.log(
  `\nDone: ${chains.length} group(s), ${movedCards} card(s) in ${dbPath}.` +
    `\nGroup names are still their codes — rename them from the group row.`
);
