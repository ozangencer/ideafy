import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { openDatabase } from "../db.js";
import { clearQueue, dequeueCard, enqueueCard, listQueueRows, queuedRunsInWorktree, type SqlDb } from "../shared.js";

// lib/card-ops/queue.ts is the one queue the app's popover and the MCP's
// queue tools share, so it runs on both drivers behind SqlDb: node:sqlite
// here, better-sqlite3 in the app.

type Driver = { name: string; open: () => SqlDb; skip?: string };

function betterSqlite(): Driver {
  const name = "better-sqlite3";
  try {
    const Database = createRequire(new URL("../../package.json", import.meta.url))("better-sqlite3");
    new Database(":memory:").close();
    return { name, open: () => new Database(":memory:") as SqlDb };
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return {
      name,
      open: () => {
        throw new Error("unreachable");
      },
      skip: `better-sqlite3 does not load under this Node (${reason}). ABI mismatch — run \`npm run rebuild:system\` and rerun.`,
    };
  }
}

const DRIVERS: Driver[] = [
  { name: "node:sqlite", open: () => openDatabase(":memory:") },
  betterSqlite(),
];

// IDE-438 waits third, IDE-436 first, IDE-421 second; IDE-437 is not queued.
// Positions with a gap, the way the status trigger leaves them.
function seed(db: SqlDb): void {
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, id_prefix TEXT);
    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      project_id TEXT,
      task_number INTEGER,
      queue_position INTEGER,
      updated_at TEXT NOT NULL
    );
    INSERT INTO projects VALUES ('p1', 'IDE');
    INSERT INTO cards VALUES ('c438', 'Focus', 'p1', 438, 5, 't0');
    INSERT INTO cards VALUES ('c436', 'Terminal queue', 'p1', 436, 1, 't0');
    INSERT INTO cards VALUES ('c421', 'Screenshots', 'p1', 421, 2, 't0');
    INSERT INTO cards VALUES ('c437', 'Running', 'p1', 437, NULL, 't0');
    INSERT INTO cards VALUES ('loose', 'No project', NULL, NULL, 3, 't0');
  `);
}

function positions(db: SqlDb): Record<string, number | null> {
  const rows = db.prepare(`SELECT id, queue_position AS p FROM cards ORDER BY id`).all() as { id: string; p: number | null }[];
  return Object.fromEntries(rows.map((row) => [row.id, row.p]));
}

for (const driver of DRIVERS) {
  const t = (name: string, fn: (db: SqlDb) => void) =>
    test(`${driver.name}: ${name}`, { skip: driver.skip }, () => fn(driver.open()));

  t("clears every waiting card and returns them in run order", (db) => {
    seed(db);
    assert.deepEqual(clearQueue(db), [
      { cardId: "c436", displayId: "IDE-436" },
      { cardId: "c421", displayId: "IDE-421" },
      { cardId: "loose", displayId: "No project" },
      { cardId: "c438", displayId: "IDE-438" },
    ]);
    assert.deepEqual(positions(db), { c421: null, c436: null, c437: null, c438: null, loose: null });
  });

  t("leaves the cards in keep queued where they were", (db) => {
    seed(db);
    const cleared = clearQueue(db, new Set(["c436"]));
    assert.deepEqual(cleared.map((c) => c.cardId), ["c421", "loose", "c438"]);
    assert.deepEqual(positions(db), { c421: null, c436: 1, c437: null, c438: null, loose: null });
  });

  t("does not touch updated_at", (db) => {
    seed(db);
    clearQueue(db);
    const stamps = db.prepare(`SELECT DISTINCT updated_at AS u FROM cards`).all() as { u: string }[];
    assert.deepEqual(stamps.map((s) => s.u), ["t0"]);
  });

  t("an empty queue clears nothing", (db) => {
    seed(db);
    clearQueue(db);
    assert.deepEqual(clearQueue(db), []);
  });
}

// The columns the queue's rules read. Planned backlog cards: IDE-501 and
// IDE-502 queued in that order, IDE-503 waiting to be added; IDE-504 has no
// plan, IDE-505 is a Human Test card with a core flow, IDE-506 is completed.
const PLAN = "<p>Files: lib/a.ts</p>";
const CORE = '<h2>Temel akış</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false">x</li></ul>';

function seedFull(db: SqlDb): void {
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, id_prefix TEXT, mode TEXT, use_worktrees INTEGER);
    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      solution_summary TEXT NOT NULL DEFAULT '',
      test_scenarios TEXT NOT NULL DEFAULT '',
      processing_type TEXT,
      queue_position INTEGER,
      task_number INTEGER,
      use_worktree INTEGER,
      git_branch_status TEXT,
      git_worktree_path TEXT,
      git_worktree_status TEXT,
      project_id TEXT,
      updated_at TEXT NOT NULL
    );
    INSERT INTO projects VALUES ('p1', 'IDE', 'development', 0);
  `);
  const add = db.prepare(`
    INSERT INTO cards (id, title, status, description, solution_summary, test_scenarios,
                       queue_position, task_number, git_branch_status, project_id, updated_at)
    VALUES (?, ?, ?, '<p>d</p>', ?, ?, ?, ?, ?, 'p1', 't0')`);
  add.run("c501", "One", "backlog", PLAN, "", 1, 501, null);
  add.run("c502", "Two", "progress", PLAN, "", 2, 502, null);
  add.run("c503", "Three", "backlog", PLAN, "", null, 503, null);
  add.run("c504", "No plan", "backlog", "", "", null, 504, null);
  add.run("c505", "Verify", "test", PLAN, CORE, null, 505, "active");
  add.run("c506", "Done", "completed", PLAN, CORE, null, 506, null);
}

const order = (db: SqlDb) => listQueueRows(db).map((row) => row.id);

for (const driver of DRIVERS) {
  const t = (name: string, fn: (db: SqlDb) => void) =>
    test(`${driver.name}: ${name}`, { skip: driver.skip }, () => {
      const db = driver.open();
      seedFull(db);
      fn(db);
    });

  t("enqueue appends by default and reports the rank", (db) => {
    const result = enqueueCard(db, "c503");
    assert.ok(result.ok);
    assert.equal(result.rank, 3);
    assert.equal(result.moved, false);
    assert.deepEqual(order(db), ["c501", "c502", "c503"]);
  });

  t("null puts a card first, a card id right behind it", (db) => {
    enqueueCard(db, "c503", null);
    assert.deepEqual(order(db), ["c503", "c501", "c502"]);
    enqueueCard(db, "c505", "c503");
    assert.deepEqual(order(db), ["c503", "c505", "c501", "c502"]);
  });

  t("a queued card is moved, not doubled", (db) => {
    const result = enqueueCard(db, "c502", null);
    assert.ok(result.ok);
    assert.equal(result.moved, true);
    assert.deepEqual(order(db), ["c502", "c501"]);
    const positions = db.prepare(`SELECT queue_position AS p FROM cards WHERE queue_position IS NOT NULL ORDER BY p`).all() as { p: number }[];
    assert.deepEqual(positions.map((row) => row.p), [1, 2]);
  });

  t("refusals say why and write nothing", (db) => {
    const noPlan = enqueueCard(db, "c504");
    assert.ok(!noPlan.ok && noPlan.reason === "ineligible" && /IDE-504: it has no plan yet/.test(noPlan.message));
    const done = enqueueCard(db, "c506");
    assert.ok(!done.ok && done.reason === "ineligible");
    const missing = enqueueCard(db, "nope");
    assert.ok(!missing.ok && missing.reason === "not-found");
    const afterLoose = enqueueCard(db, "c503", "c504");
    assert.ok(!afterLoose.ok && afterLoose.reason === "after-not-queued");
    const afterSelf = enqueueCard(db, "c503", "c503");
    assert.ok(!afterSelf.ok && afterSelf.reason === "after-self");
    assert.deepEqual(order(db), ["c501", "c502"]);
  });

  t("dequeue closes the gap and says whether the card was queued", (db) => {
    enqueueCard(db, "c503");
    assert.equal(dequeueCard(db, "c502"), true);
    assert.equal(dequeueCard(db, "c502"), false);
    const rows = db.prepare(`SELECT id, queue_position AS p FROM cards WHERE queue_position IS NOT NULL ORDER BY p`).all() as { id: string; p: number }[];
    assert.deepEqual(rows.map((row) => [row.id, row.p]), [["c501", 1], ["c503", 2]]);
  });

  t("writes after a trigger-left gap still leave 1..N", (db) => {
    // The status trigger clears one card without renumbering the rest.
    db.exec(`UPDATE cards SET queue_position = 7 WHERE id = 'c502'`);
    enqueueCard(db, "c503", "c501");
    enqueueCard(db, "c505");
    const positions = db.prepare(`SELECT id, queue_position AS p FROM cards WHERE queue_position IS NOT NULL ORDER BY p`).all() as { id: string; p: number }[];
    assert.deepEqual(positions.map((row) => [row.id, row.p]), [["c501", 1], ["c503", 2], ["c502", 3], ["c505", 4]]);
  });

  t("queue writes do not touch updated_at", (db) => {
    enqueueCard(db, "c503", null);
    dequeueCard(db, "c501");
    const stamps = db.prepare(`SELECT DISTINCT updated_at AS u FROM cards`).all() as { u: string }[];
    assert.deepEqual(stamps.map((s) => s.u), ["t0"]);
  });

  t("rows read booleans and the run's folder the way the app does", (db) => {
    enqueueCard(db, "c505");
    const [, , verify] = listQueueRows(db);
    assert.equal(verify.projectUseWorktrees, false);
    // A pre-verify goes to the card's active worktree; it has none here.
    assert.equal(queuedRunsInWorktree(verify), false);
    db.exec(`UPDATE cards SET use_worktree = 1 WHERE id = 'c501'`);
    const [first] = listQueueRows(db);
    assert.equal(first.useWorktree, true);
    assert.equal(queuedRunsInWorktree(first), true);
  });
}
