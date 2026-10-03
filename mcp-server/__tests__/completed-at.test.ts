import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, type Db } from "../db.js";
import { completedAtAssignment } from "../completed-at.js";

function makeDb(withColumn = true): Db {
  const db = openDatabase(":memory:");
  db.exec(`
    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      ${withColumn ? "completed_at TEXT," : ""}
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

/** The UPDATE move_card runs, so the test exercises the same SQL shape. */
function move(db: Db, id: string, status: string, now: string) {
  const completedAt = completedAtAssignment(db, status, now);
  db.prepare(
    `UPDATE cards SET status = ?, updated_at = ?${completedAt ? `, ${completedAt.sql}` : ""} WHERE id = ?`
  ).run(status, now, ...(completedAt?.params ?? []), id);
}

function completedAt(db: Db, id: string): string | null {
  return (db.prepare(`SELECT completed_at FROM cards WHERE id = ?`).get(id) as { completed_at: string | null })
    .completed_at;
}

test("entering Completed stamps completed_at", () => {
  const db = makeDb();
  db.prepare(`INSERT INTO cards VALUES ('c1', 'test', NULL, 't0')`).run();
  move(db, "c1", "completed", "t1");
  assert.equal(completedAt(db, "c1"), "t1");
});

test("leaving Completed clears completed_at", () => {
  const db = makeDb();
  db.prepare(`INSERT INTO cards VALUES ('c1', 'completed', 't0', 't0')`).run();
  move(db, "c1", "progress", "t1");
  assert.equal(completedAt(db, "c1"), null);
});

test("moving a completed card to Completed again keeps the day it was finished", () => {
  const db = makeDb();
  db.prepare(`INSERT INTO cards VALUES ('c1', 'completed', 't0', 't0')`).run();
  move(db, "c1", "completed", "t1");
  assert.equal(completedAt(db, "c1"), "t0");
});

test("moves between two other columns leave completed_at alone", () => {
  const db = makeDb();
  db.prepare(`INSERT INTO cards VALUES ('c1', 'backlog', NULL, 't0')`).run();
  move(db, "c1", "progress", "t1");
  assert.equal(completedAt(db, "c1"), null);
});

test("a database without the column gets no assignment", () => {
  const db = makeDb(false);
  assert.equal(completedAtAssignment(db, "completed", "t1"), null);
  db.prepare(`INSERT INTO cards VALUES ('c1', 'test', 't0')`).run();
  move(db, "c1", "completed", "t1");
  const row = db.prepare(`SELECT status FROM cards WHERE id = 'c1'`).get() as { status: string };
  assert.equal(row.status, "completed");
});
