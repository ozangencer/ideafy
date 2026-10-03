import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { openDatabase } from "../db.js";
import { completedAtFor, moveCard, type SqlDb } from "../shared.js";

// lib/card-ops/move-card.ts is the one column move the app's routes and the
// MCP's move_card share. It has to behave the same on both drivers behind
// SqlDb: node:sqlite here in the MCP, better-sqlite3 in the app. So every
// scenario runs twice.
//
// IDE-406 is why completed_at is in here: move_card used to write status
// alone, so a card finished from a terminal never got a date — the Completed
// column sorted it last, "completed today" skipped it, and the scratch sweep
// fell back to updated_at.

type Driver = { name: string; open: () => SqlDb; skip?: string };

function betterSqlite(): Driver {
  const name = "better-sqlite3";
  try {
    // The app's driver, from the repo root — mcp-server never depends on it.
    const Database = createRequire(new URL("../../package.json", import.meta.url))("better-sqlite3");
    new Database(":memory:").close();
    return { name, open: () => new Database(":memory:") as SqlDb };
  } catch (error) {
    // The root binary is built for Electron's ABI after `npm run pack` /
    // `rebuild:electron`. Say so instead of passing green on one driver.
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

function seed(db: SqlDb, status: string, completedAt: string | null): void {
  db.exec(`
    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare(`INSERT INTO cards VALUES ('c1', ?, ?, 't0')`).run(status, completedAt);
}

function row(db: SqlDb): { status: string; completed_at: string | null; updated_at: string } {
  // Spread: node:sqlite rows are null-prototype objects, which deepEqual
  // would tell apart from the plain literal.
  return { ...(db.prepare(`SELECT status, completed_at, updated_at FROM cards WHERE id = 'c1'`).get() as object) } as {
    status: string;
    completed_at: string | null;
    updated_at: string;
  };
}

for (const driver of DRIVERS) {
  const t = (name: string, fn: (db: SqlDb) => void) =>
    test(`${driver.name}: ${name}`, { skip: driver.skip }, () => fn(driver.open()));

  t("entering Completed stamps completed_at", (db) => {
    seed(db, "test", null);
    const result = moveCard(db, "c1", "completed", "t1");
    assert.deepEqual(result, { ok: true, changed: true, from: "test", to: "completed", completedAt: "t1" });
    assert.deepEqual(row(db), { status: "completed", completed_at: "t1", updated_at: "t1" });
  });

  t("leaving Completed clears completed_at", (db) => {
    seed(db, "completed", "t0");
    moveCard(db, "c1", "progress", "t1");
    assert.deepEqual(row(db), { status: "progress", completed_at: null, updated_at: "t1" });
  });

  t("a move between two other columns leaves completed_at alone", (db) => {
    seed(db, "backlog", null);
    moveCard(db, "c1", "progress", "t1");
    assert.deepEqual(row(db), { status: "progress", completed_at: null, updated_at: "t1" });
  });

  t("moving a completed card to Completed again keeps the day it was finished", (db) => {
    seed(db, "completed", "t0");
    const result = moveCard(db, "c1", "completed", "t1");
    assert.equal(result.ok && result.changed, false);
    assert.equal(row(db).completed_at, "t0");
  });

  t("an unknown column is refused and nothing is written", (db) => {
    seed(db, "backlog", null);
    assert.deepEqual(moveCard(db, "c1", "Backlog", "t1"), { ok: false, reason: "invalid-status" });
    assert.deepEqual(row(db), { status: "backlog", completed_at: null, updated_at: "t0" });
  });

  t("a missing card is reported, not written", (db) => {
    seed(db, "backlog", null);
    assert.deepEqual(moveCard(db, "nope", "completed", "t1"), { ok: false, reason: "not-found" });
  });
}

test("completedAtFor: the rule the app's PUT route and update_card share", () => {
  assert.equal(completedAtFor("test", "completed", null, "now"), "now");
  assert.equal(completedAtFor("completed", "bugs", "t0", "now"), null);
  assert.equal(completedAtFor("completed", "completed", "t0", "now"), "t0");
  assert.equal(completedAtFor("backlog", "progress", null, "now"), null);
});
