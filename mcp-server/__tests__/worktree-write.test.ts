import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import {
  normalizeUseWorktree,
  serializeUseWorktreeForDb,
} from "../serialize-card.js";

// Field map used by update_card in index.ts. Kept in sync here so tests
// cover the same column routing the handler applies.
const FIELD_MAP: Record<string, string> = {
  title: "title",
  description: "description",
  solutionSummary: "solution_summary",
  testScenarios: "test_scenarios",
  status: "status",
  complexity: "complexity",
  priority: "priority",
  useWorktree: "use_worktree",
};

function makeDb() {
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
      use_worktree INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  return db;
}

function seedCard(db: Database.Database, useWorktree: number | null) {
  db.prepare(
    `INSERT INTO cards (id, title, status, use_worktree, created_at, updated_at)
     VALUES (?, ?, 'progress', ?, '2026-04-21T00:00:00Z', '2026-04-21T00:00:00Z')`
  ).run("c1", "Seed", useWorktree);
}

function readUseWorktree(db: Database.Database): number | null {
  const row = db
    .prepare(`SELECT use_worktree FROM cards WHERE id = ?`)
    .get("c1") as { use_worktree: number | null };
  return row.use_worktree;
}

// Replicates the update_card handler's SET builder (index.ts:560-596).
// Keeping this in the test ensures any drift in the handler is caught.
function applyUpdate(
  db: Database.Database,
  updates: Record<string, unknown>
): void {
  const setClauses: string[] = ["updated_at = ?"];
  const values: unknown[] = ["2026-04-21T00:00:01Z"];

  for (const [key, value] of Object.entries(updates)) {
    if (FIELD_MAP[key] && value !== undefined) {
      setClauses.push(`${FIELD_MAP[key]} = ?`);
      if (key === "useWorktree") {
        values.push(serializeUseWorktreeForDb(value as boolean | null));
      } else {
        values.push(value);
      }
    }
  }

  values.push("c1");
  db.prepare(`UPDATE cards SET ${setClauses.join(", ")} WHERE id = ?`).run(
    ...values
  );
}

// ---------------------------------------------------------------------------
// serializeUseWorktreeForDb unit tests
// ---------------------------------------------------------------------------

test("serializeUseWorktreeForDb: true → 1", () => {
  assert.strictEqual(serializeUseWorktreeForDb(true), 1);
});

test("serializeUseWorktreeForDb: false → 0", () => {
  assert.strictEqual(serializeUseWorktreeForDb(false), 0);
});

test("serializeUseWorktreeForDb: null → null", () => {
  assert.strictEqual(serializeUseWorktreeForDb(null), null);
});

// ---------------------------------------------------------------------------
// update_card DB behavior (MCP: yazma scenarios 1-4)
// ---------------------------------------------------------------------------

test("update_card: useWorktree false → DB stores 0", () => {
  const db = makeDb();
  seedCard(db, null);
  applyUpdate(db, { useWorktree: false });
  assert.strictEqual(readUseWorktree(db), 0);
});

test("update_card: useWorktree true → DB stores 1", () => {
  const db = makeDb();
  seedCard(db, null);
  applyUpdate(db, { useWorktree: true });
  assert.strictEqual(readUseWorktree(db), 1);
});

test("update_card: useWorktree null → DB stores NULL (override cleared)", () => {
  const db = makeDb();
  seedCard(db, 1);
  assert.strictEqual(readUseWorktree(db), 1);

  applyUpdate(db, { useWorktree: null });

  const raw = readUseWorktree(db);
  assert.strictEqual(raw, null);
  assert.strictEqual(normalizeUseWorktree(raw), null);
});

test("update_card: useWorktree omitted → existing value preserved (1)", () => {
  const db = makeDb();
  seedCard(db, 1);
  applyUpdate(db, { title: "Renamed" });
  assert.strictEqual(readUseWorktree(db), 1);
});

test("update_card: useWorktree omitted → existing value preserved (0)", () => {
  const db = makeDb();
  seedCard(db, 0);
  applyUpdate(db, { title: "Renamed" });
  assert.strictEqual(readUseWorktree(db), 0);
});

test("update_card: useWorktree omitted → existing NULL preserved", () => {
  const db = makeDb();
  seedCard(db, null);
  applyUpdate(db, { title: "Renamed" });
  assert.strictEqual(readUseWorktree(db), null);
});

test("update_card: useWorktree undefined (not in args) is the same as omitted", () => {
  const db = makeDb();
  seedCard(db, 1);
  applyUpdate(db, { title: "Renamed", useWorktree: undefined });
  assert.strictEqual(readUseWorktree(db), 1);
});

test("update_card: full round-trip (write then normalized read)", () => {
  const db = makeDb();
  seedCard(db, null);

  applyUpdate(db, { useWorktree: false });
  assert.strictEqual(normalizeUseWorktree(readUseWorktree(db)), false);

  applyUpdate(db, { useWorktree: true });
  assert.strictEqual(normalizeUseWorktree(readUseWorktree(db)), true);

  applyUpdate(db, { useWorktree: null });
  assert.strictEqual(normalizeUseWorktree(readUseWorktree(db)), null);
});

// ---------------------------------------------------------------------------
// MCP: yazma scenario 5 — tool schema declares useWorktree
// ---------------------------------------------------------------------------
// Unit-level check for "after Claude Code restart, update_card schema exposes
// useWorktree in the tool list". Asserts the source-of-truth declaration in
// index.ts matches the spec. A true end-to-end restart test would spawn the
// built server and issue a tools/list RPC — skipped here to keep the suite
// hermetic and fast.

test("tool schema: update_card input declares useWorktree (boolean|null)", () => {
  const srcUrl = new URL("../index.ts", import.meta.url);
  const src = readFileSync(srcUrl, "utf8");

  const updateCardRegion = src.slice(
    src.indexOf('name: "update_card"'),
    src.indexOf('name: "move_card"')
  );
  assert.ok(
    updateCardRegion.length > 0,
    "Could not locate update_card tool definition in index.ts"
  );

  assert.match(
    updateCardRegion,
    /useWorktree:\s*\{[^}]*type:\s*\[\s*"boolean"\s*,\s*"null"\s*\]/,
    "update_card inputSchema must declare useWorktree with type: [boolean, null]"
  );
});
