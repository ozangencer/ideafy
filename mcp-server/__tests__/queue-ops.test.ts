import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { openDatabase } from "../db.js";
import { clearQueue, type SqlDb } from "../shared.js";

// lib/card-ops/queue.ts's clearQueue is the one Clear the app's queue popover
// and the MCP's clear_queue share, so it runs on both drivers behind SqlDb:
// node:sqlite here, better-sqlite3 in the app.

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
