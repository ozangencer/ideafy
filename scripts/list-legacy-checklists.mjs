#!/usr/bin/env node
/**
 * Which checklists predate the core-flow contract.
 *
 * `lib/prompts/test-style.ts` says a checklist opens with a capped
 * `Core flow` / `Temel akış` group and that everything after it is optional.
 * `lib/test-progress.ts` reads that heading to show `4/5 core · +41` on the
 * card face instead of a flat `1/46`. Cards written before the contract carry
 * no such heading, so on them the badge falls back to the flat count and the
 * agent has no core flow to pre-verify — the contract only ever worked
 * forwards.
 *
 * This script is the "which ones" half of fixing that, and afterwards the
 * verification half: when the migration is done the Human Test count reaches
 * zero. Cards in other columns are reported too but are not the migration's
 * job — see the note on `save_tests` below.
 *
 *   node scripts/list-legacy-checklists.mjs           # human-readable report
 *   node scripts/list-legacy-checklists.mjs --json    # machine-readable
 *   node scripts/list-legacy-checklists.mjs --all     # include Completed too
 *
 * Read-only. It never writes to the database.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The heading that opens the core group, in either language the contract writes. */
const CORE_HEADING = /^(core\s*flow|temel\s*ak[ıi][şs])$/;

/**
 * Columns where a checklist still has a job to do. Completed and withdrawn
 * cards are done — nobody is going to walk their checklist again, so
 * rewriting them would be work that buys nothing.
 */
const ACTIVE_STATUSES = ["ideation", "backlog", "bugs", "progress", "test"];

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

/** Heading label without markup, entities, casing, or stray whitespace. */
function normalizeHeading(raw) {
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function headingsOf(html) {
  return [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) =>
    normalizeHeading(m[1])
  );
}

function countChecks(html) {
  const checked = (html.match(/data-checked="true"/g) || []).length;
  const unchecked = (html.match(/data-checked="false"/g) || []).length;
  return { checked, total: checked + unchecked };
}

const asJson = process.argv.includes("--json");
const includeDone = process.argv.includes("--all");

const db = new Database(resolveDbPath(), { readonly: true });
db.pragma("busy_timeout = 5000");

const rows = db
  .prepare(
    `SELECT c.id, c.task_number, c.title, c.status, c.test_scenarios, p.id_prefix
       FROM cards c
       LEFT JOIN projects p ON p.id = c.project_id
      ORDER BY c.status, c.task_number`
  )
  .all();

const legacy = [];
for (const row of rows) {
  if (!includeDone && !ACTIVE_STATUSES.includes(row.status)) continue;

  const html = row.test_scenarios ?? "";
  const { checked, total } = countChecks(html);
  if (total === 0) continue; // no checklist at all — a different problem

  const headings = headingsOf(html);
  if (headings.some((h) => CORE_HEADING.test(h))) continue;

  legacy.push({
    // A card with no project or no task number has no display id in the app
    // either; the short uuid is a locator, not an id the user would recognise,
    // so it is marked as such rather than passed off as one.
    displayId:
      row.id_prefix && row.task_number
        ? `${row.id_prefix}-${row.task_number}`
        : `~${row.id.slice(0, 8)}`,
    id: row.id,
    title: row.title,
    status: row.status,
    checked,
    total,
    headings,
  });
}

db.close();

if (asJson) {
  console.log(JSON.stringify(legacy, null, 2));
  process.exit(0);
}

if (legacy.length === 0) {
  console.log("No legacy checklists left — every checklist opens with a core group.");
  process.exit(0);
}

const width = Math.max(...legacy.map((c) => c.displayId.length));
for (const card of legacy) {
  const marker = card.checked > 0 ? "*" : " ";
  console.log(
    `${marker} ${card.displayId.padEnd(width)}  ${card.status.padEnd(9)}` +
      `  ${String(card.checked).padStart(3)}/${String(card.total).padEnd(3)}` +
      `  ${card.title.slice(0, 56)}`
  );
  // No <h2> means there is nothing to close a prepended core group, so
  // `findCoreSection` would slice to the end of the document and count the
  // whole list as the core flow. Those cards need a heading inserted after
  // the new group, and saying so here is cheaper than discovering it on the
  // card face.
  if (card.headings.length === 0) {
    console.log(`  ${" ".repeat(width)}  !! no <h2> group — a prepended core group would swallow the whole list`);
  }
}

const withChecks = legacy.filter((c) => c.checked > 0);
const items = legacy.reduce((sum, c) => sum + c.total, 0);
const headless = legacy.filter((c) => c.headings.length === 0);
const inTest = legacy.filter((c) => c.status === "test");
const elsewhere = legacy.filter((c) => c.status !== "test");

console.log();
console.log(`${legacy.length} checklist(s) without a core group, ${items} items total`);
console.log(`  ${withChecks.length} carry checked items (marked *) — nothing may be dropped from these`);
if (headless.length > 0) {
  console.log(`  ${headless.length} have no <h2> at all — see the !! lines above`);
}
console.log(`  ${inTest.length} in Human Test — this is the number the migration drives to zero`);
if (elsewhere.length > 0) {
  // `save_tests` also moves the card to Human Test, so running the migration
  // over a card that is still being worked on would file unfinished work into
  // the test queue. Those cards get their checklist when their work lands.
  console.log(
    `  ${elsewhere.length} elsewhere (${[...new Set(elsewhere.map((c) => c.status))].join(", ")}) — left alone, save_tests would move them to Human Test`
  );
}
