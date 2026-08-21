#!/usr/bin/env node
/**
 * Give an old-format checklist a core flow without touching what is already
 * there.
 *
 * The companion to `list-legacy-checklists.mjs`. That script says which cards
 * predate the `Core flow` / `Temel akış` contract; this one prepends the group
 * a human wrote for each of them and leaves every existing item byte-for-byte
 * as it stands.
 *
 *   node scripts/prepend-core-flow.mjs --input core-flows.json [--dry-run]
 *
 * The input is `{ "<display id>": { "heading": "Temel akış", "items": [...] } }`.
 * Items are plain text with `backticks` and **bold** allowed.
 *
 * Why a script and not `save_tests`:
 *
 *   1. `save_tests` takes markdown and re-renders the WHOLE checklist. To
 *      prepend five items to a card with 95, the caller has to retype all 95 —
 *      and any `<code>` span or entity it fails to reproduce is silently
 *      rewritten while the call claims to have preserved them. Prepending a
 *      string cannot lose what it never parses.
 *   2. `save_tests` sets `status = 'test'` and bumps `updated_at`. The status
 *      is wrong for a card still in progress, and the timestamp is worse: it
 *      is the signal `lib/card-age.ts` reads for staleness, so migrating 25
 *      cards would empty Human Test's Stale row and push its WIP count from
 *      13 to 34 — a board-wide lie told by a migration that changed no work.
 *
 * Editing text nobody has verified is one thing; claiming activity that never
 * happened is another. This script writes `test_scenarios` and nothing else.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CORE_HEADING = /^(core\s*flow|temel\s*ak[ıi][şs])$/;
const MAX_ITEMS = 5; // the contract's cap, enforced here so a slip is loud

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

function normalizeHeading(raw) {
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hasCoreGroup(html) {
  return [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)]
    .map((m) => normalizeHeading(m[1]))
    .some((h) => CORE_HEADING.test(h));
}

/** Entities first, then the two inline marks, so a `<` inside code survives. */
function toHtml(text) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

/**
 * The exact shape Tiptap's TaskList round-trips. Items start unchecked: a
 * migration has verified nothing.
 */
function buildGroup(heading, items) {
  const lis = items.map(
    (text) =>
      `<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>${toHtml(
        text
      )}</p></div></li>`
  );
  return `<h2>${toHtml(heading)}</h2>\n<ul data-type="taskList">${lis.join("\n")}\n</ul>\n`;
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const inputPath = args[args.indexOf("--input") + 1];
if (!inputPath || !fs.existsSync(inputPath)) {
  console.error("Usage: node scripts/prepend-core-flow.mjs --input <file.json> [--dry-run]");
  process.exit(1);
}

const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const db = new Database(resolveDbPath());
db.pragma("busy_timeout = 5000");

const byDisplayId = db.prepare(
  `SELECT c.id, c.task_number, c.status, c.test_scenarios, p.id_prefix
     FROM cards c LEFT JOIN projects p ON p.id = c.project_id
    WHERE p.id_prefix = ? AND c.task_number = ?`
);
// Cards with no project or no task number have no display id in the app
// either, so they are keyed by uuid — `IDE-283`.split("-") would give this
// statement a NaN to bind.
const byUuid = db.prepare(
  `SELECT c.id, c.task_number, c.status, c.test_scenarios, p.id_prefix
     FROM cards c LEFT JOIN projects p ON p.id = c.project_id
    WHERE c.id = ?`
);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// updated_at is deliberately absent from this statement — see the header.
const write = db.prepare(`UPDATE cards SET test_scenarios = ? WHERE id = ?`);

let applied = 0;
let skipped = 0;

for (const [displayId, spec] of Object.entries(input)) {
  let card;
  if (UUID.test(displayId)) {
    card = byUuid.get(displayId);
  } else {
    const [prefix, number] = displayId.split("-");
    card = byDisplayId.get(prefix, Number(number));
  }

  if (!card) {
    console.error(`  !! ${displayId}: no such card`);
    skipped++;
    continue;
  }
  if (!spec.items?.length) {
    console.error(`  !! ${displayId}: no items`);
    skipped++;
    continue;
  }
  if (spec.items.length > MAX_ITEMS) {
    console.error(`  !! ${displayId}: ${spec.items.length} items, the contract caps the core group at ${MAX_ITEMS}`);
    skipped++;
    continue;
  }

  const existing = card.test_scenarios ?? "";
  // Idempotent: re-running after a partial pass must not stack a second core
  // group on top of the first.
  if (hasCoreGroup(existing)) {
    console.log(`  =  ${displayId}: already has a core group`);
    skipped++;
    continue;
  }
  // Without a following <h2>, findCoreSection slices to the end of the
  // document and the whole list counts as the core flow.
  if (!/<h2\b/i.test(existing)) {
    console.error(`  !! ${displayId}: no <h2> to close the new group — needs a heading inserted by hand`);
    skipped++;
    continue;
  }

  const next = buildGroup(spec.heading ?? "Temel akış", spec.items) + existing;
  if (!dryRun) write.run(next, card.id);
  console.log(`  ${dryRun ? "~" : "+"}  ${displayId}: ${spec.items.length} items prepended (${card.status})`);
  applied++;
}

db.close();
console.log(`\n${dryRun ? "would apply" : "applied"} ${applied}, skipped ${skipped}`);
