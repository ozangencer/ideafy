import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { normalizeUseWorktree } from "../serialize-card.js";

// The SELECT lists used by get_card and list_cards in index.ts.
const CARD_COLUMNS = `
  id, title, description,
  solution_summary as solutionSummary,
  test_scenarios as testScenarios,
  status, complexity, priority,
  project_folder as projectFolder,
  project_id as projectId,
  task_number as taskNumber,
  git_worktree_path as gitWorktreePath,
  git_worktree_status as gitWorktreeStatus,
  use_worktree as useWorktree,
  created_at as createdAt,
  updated_at as updatedAt
`;

function makeTestDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      solution_summary TEXT DEFAULT '',
      test_scenarios TEXT DEFAULT '',
      status TEXT NOT NULL,
      complexity TEXT DEFAULT 'medium',
      priority TEXT DEFAULT 'medium',
      project_folder TEXT DEFAULT '',
      project_id TEXT,
      task_number INTEGER,
      git_worktree_path TEXT,
      git_worktree_status TEXT,
      use_worktree INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  return db;
}

function insertCard(
  db: Database.Database,
  overrides: Partial<{
    id: string;
    title: string;
    useWorktree: number | null;
    gitWorktreePath: string | null;
    gitWorktreeStatus: string | null;
  }> = {}
) {
  const row = {
    id: overrides.id ?? "card-1",
    title: overrides.title ?? "Test card",
    useWorktree: overrides.useWorktree ?? null,
    gitWorktreePath: overrides.gitWorktreePath ?? null,
    gitWorktreeStatus: overrides.gitWorktreeStatus ?? null,
  };
  db.prepare(
    `INSERT INTO cards (
      id, title, status, git_worktree_path, git_worktree_status, use_worktree,
      created_at, updated_at
    ) VALUES (?, ?, 'progress', ?, ?, ?, '2026-04-21T00:00:00Z', '2026-04-21T00:00:00Z')`
  ).run(
    row.id,
    row.title,
    row.gitWorktreePath,
    row.gitWorktreeStatus,
    row.useWorktree
  );
  return row;
}

function selectOne(db: Database.Database, id: string) {
  const card = db
    .prepare(`SELECT ${CARD_COLUMNS} FROM cards WHERE id = ?`)
    .get(id) as Record<string, unknown>;
  card.useWorktree = normalizeUseWorktree(card.useWorktree as number | null);
  return card;
}

function selectAll(db: Database.Database) {
  const rows = db.prepare(`SELECT ${CARD_COLUMNS} FROM cards ORDER BY id`)
    .all() as Array<Record<string, unknown>>;
  for (const row of rows) {
    row.useWorktree = normalizeUseWorktree(row.useWorktree as number | null);
  }
  return rows;
}

test("normalizeUseWorktree: 1 -> true, 0 -> false", () => {
  assert.equal(normalizeUseWorktree(1), true);
  assert.equal(normalizeUseWorktree(0), false);
});

test("normalizeUseWorktree: null/undefined stays null", () => {
  assert.equal(normalizeUseWorktree(null), null);
  assert.equal(normalizeUseWorktree(undefined), null);
});

test("normalizeUseWorktree: does not coerce null to 0/false", () => {
  const result = normalizeUseWorktree(null);
  assert.notEqual(result, 0);
  assert.notEqual(result, false);
  assert.strictEqual(result, null);
});

test("get_card output includes useWorktree, gitWorktreePath, gitWorktreeStatus fields", () => {
  const db = makeTestDb();
  insertCard(db, {
    id: "c1",
    useWorktree: 1,
    gitWorktreePath: "/tmp/wt/c1",
    gitWorktreeStatus: "active",
  });

  const card = selectOne(db, "c1");

  assert.ok("useWorktree" in card, "useWorktree field present");
  assert.ok("gitWorktreePath" in card, "gitWorktreePath field present");
  assert.ok("gitWorktreeStatus" in card, "gitWorktreeStatus field present");
  assert.equal(card.gitWorktreePath, "/tmp/wt/c1");
  assert.equal(card.gitWorktreeStatus, "active");
});

test("get_card JSON: SQLite 1 serializes as boolean true (no integer leak)", () => {
  const db = makeTestDb();
  insertCard(db, { id: "c1", useWorktree: 1 });

  const card = selectOne(db, "c1");
  const json = JSON.parse(JSON.stringify(card));

  assert.strictEqual(typeof json.useWorktree, "boolean");
  assert.strictEqual(json.useWorktree, true);
});

test("get_card JSON: SQLite 0 serializes as boolean false (no integer leak)", () => {
  const db = makeTestDb();
  insertCard(db, { id: "c1", useWorktree: 0 });

  const card = selectOne(db, "c1");
  const json = JSON.parse(JSON.stringify(card));

  assert.strictEqual(typeof json.useWorktree, "boolean");
  assert.strictEqual(json.useWorktree, false);
});

test("get_card JSON: useWorktree null stays null (not coerced to 0/false)", () => {
  const db = makeTestDb();
  insertCard(db, { id: "c1", useWorktree: null });

  const card = selectOne(db, "c1");
  const json = JSON.parse(JSON.stringify(card));

  assert.strictEqual(json.useWorktree, null);
  assert.notStrictEqual(json.useWorktree, 0);
  assert.notStrictEqual(json.useWorktree, false);
});

test("list_cards: each row exposes useWorktree/gitWorktreePath/gitWorktreeStatus", () => {
  const db = makeTestDb();
  insertCard(db, {
    id: "c1",
    useWorktree: 1,
    gitWorktreePath: "/wt/c1",
    gitWorktreeStatus: "active",
  });
  insertCard(db, {
    id: "c2",
    useWorktree: 0,
    gitWorktreePath: null,
    gitWorktreeStatus: null,
  });
  insertCard(db, {
    id: "c3",
    useWorktree: null,
  });

  const rows = selectAll(db);

  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.ok("useWorktree" in row);
    assert.ok("gitWorktreePath" in row);
    assert.ok("gitWorktreeStatus" in row);
  }
});

test("list_cards: booleans normalized per row, null preserved", () => {
  const db = makeTestDb();
  insertCard(db, { id: "c1", useWorktree: 1 });
  insertCard(db, { id: "c2", useWorktree: 0 });
  insertCard(db, { id: "c3", useWorktree: null });

  const json = JSON.parse(JSON.stringify(selectAll(db)));

  assert.strictEqual(json[0].useWorktree, true);
  assert.strictEqual(json[1].useWorktree, false);
  assert.strictEqual(json[2].useWorktree, null);
});

test("list_cards: no integer leaks in any row", () => {
  const db = makeTestDb();
  for (let i = 0; i < 5; i++) {
    insertCard(db, { id: `c${i}`, useWorktree: i % 2 });
  }

  const json = JSON.parse(JSON.stringify(selectAll(db)));

  for (const row of json) {
    assert.ok(
      typeof row.useWorktree === "boolean" || row.useWorktree === null,
      `useWorktree must be boolean or null, got ${typeof row.useWorktree}`
    );
    assert.notStrictEqual(row.useWorktree, 0);
    assert.notStrictEqual(row.useWorktree, 1);
  }
});
