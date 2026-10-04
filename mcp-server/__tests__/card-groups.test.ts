import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { openDatabase } from "../db.js";
import {
  CardGroupError,
  DEFAULT_GROUP_COLOR,
  assertGroupAssignable,
  createGroup,
  deleteGroup,
  listGroups,
  moveCardInChain,
  normalizeGroupCode,
  normalizeGroupId,
  updateGroup,
  type SqlDb,
} from "../shared.js";

// lib/card-ops/groups.ts is the one place a card group is written: the app's
// /api/card-groups routes and the MCP's group tools both call it. Every
// scenario runs on both drivers behind SqlDb — node:sqlite here, the app's
// better-sqlite3 — as move-card.test.ts does.

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

function seed(db: SqlDb): SqlDb {
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      group_id TEXT,
      group_order INTEGER,
      task_number INTEGER
    );
    CREATE TABLE card_groups (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TRIGGER cards_group_order_reset AFTER UPDATE OF group_id ON cards
    WHEN OLD.group_id IS NOT NEW.group_id
    BEGIN UPDATE cards SET group_order = NULL WHERE id = NEW.id; END;
    INSERT INTO projects (id) VALUES ('p1'), ('p2');
  `);
  return db;
}

function addCard(db: SqlDb, id: string, groupId: string | null, project = "p1", order: number | null = null) {
  db.prepare(`INSERT INTO cards (id, project_id, group_id, group_order) VALUES (?, ?, ?, ?)`).run(
    id,
    project,
    groupId,
    order
  );
}

function plain(row: unknown): Record<string, unknown> {
  return { ...(row as object) };
}

test("normalizeGroupCode matches the card modal picker", () => {
  assert.equal(normalizeGroupCode(" mobile app!"), "MOBILE");
  assert.equal(normalizeGroupCode("ios-2"), "IOS2");
  assert.equal(normalizeGroupCode("---"), "");
});

test("normalizeGroupId: \"\" and null both take a card out of its group", () => {
  assert.equal(normalizeGroupId(undefined), undefined);
  assert.equal(normalizeGroupId(null), null);
  assert.equal(normalizeGroupId(""), null);
  assert.equal(normalizeGroupId("  "), null);
  assert.equal(normalizeGroupId("g1"), "g1");
});

for (const driver of DRIVERS) {
  const t = (name: string, fn: (db: SqlDb) => void) =>
    test(`${driver.name}: ${name}`, { skip: driver.skip }, () => fn(seed(driver.open())));

  t("createGroup writes a normalised row and defaults the name to the code", (db) => {
    const g = createGroup(db, { code: "mob", projectId: "p1" });
    assert.equal(g.code, "MOB");
    assert.equal(g.name, "MOB");
    assert.equal(g.memberCount, 0);
    const row = db.prepare(`SELECT code, name, project_id FROM card_groups WHERE id = ?`).get(g.id);
    assert.deepEqual(plain(row), { code: "MOB", name: "MOB", project_id: "p1" });
  });

  t("createGroup without a color gets the picker's default; an explicit null stays null", (db) => {
    assert.equal(DEFAULT_GROUP_COLOR, "#5e6ad2");
    assert.equal(createGroup(db, { code: "A" }).color, DEFAULT_GROUP_COLOR);
    assert.equal(createGroup(db, { code: "B", color: null }).color, null);
    assert.equal(createGroup(db, { code: "C", color: "#22c55e" }).color, "#22c55e");
    const stored = db.prepare(`SELECT color FROM card_groups WHERE code = 'A'`).get();
    assert.deepEqual(plain(stored), { color: DEFAULT_GROUP_COLOR });
  });

  t("createGroup rejects an empty code and an unknown project", (db) => {
    assert.throws(() => createGroup(db, { code: "!!" }), CardGroupError);
    assert.throws(() => createGroup(db, { code: "OK", projectId: "nope" }), /Project not found/);
  });

  t("a code clashes within the project and with global groups, not across projects", (db) => {
    const first = createGroup(db, { code: "MOBILE", projectId: "p1" });
    assert.throws(
      () => createGroup(db, { code: "mobile", projectId: "p1" }),
      (err: unknown) => err instanceof CardGroupError && err.kind === "conflict" && err.message.includes(first.id)
    );
    assert.doesNotThrow(() => createGroup(db, { code: "MOBILE", projectId: "p2" }));
    assert.throws(() => createGroup(db, { code: "MOBILE" }), CardGroupError);
    createGroup(db, { code: "SHARED" });
    assert.throws(() => createGroup(db, { code: "SHARED", projectId: "p1" }), CardGroupError);
  });

  t("listGroups with a project returns its groups plus global ones, with member counts", (db) => {
    const own = createGroup(db, { code: "A", projectId: "p1" });
    createGroup(db, { code: "B", projectId: "p2" });
    createGroup(db, { code: "C" });
    addCard(db, "c1", own.id);
    addCard(db, "c2", own.id);

    const forP1 = listGroups(db, "p1");
    assert.deepEqual(forP1.map((g) => g.code), ["A", "C"]);
    assert.equal(forP1[0].memberCount, 2);
    assert.equal(listGroups(db).length, 3);
  });

  t("updateGroup renames, returns an empty update untouched, refuses a clashing code", (db) => {
    const a = createGroup(db, { code: "A", projectId: "p1" });
    createGroup(db, { code: "B", projectId: "p1" });
    assert.equal(updateGroup(db, a.id, { name: "Mobile app" }).name, "Mobile app");
    assert.equal(updateGroup(db, a.id, {}).name, "Mobile app");
    assert.equal(updateGroup(db, a.id, { code: "a!" }).code, "A");
    assert.throws(() => updateGroup(db, a.id, { code: "b" }), /already used/);
    assert.throws(
      () => updateGroup(db, "missing", { name: "x" }),
      (err: unknown) => err instanceof CardGroupError && err.kind === "not_found"
    );
  });

  t("updateGroup moves a group between projects and checks the code in the new scope", (db) => {
    const g = createGroup(db, { code: "WEB", projectId: "p1" });
    createGroup(db, { code: "WEB", projectId: "p2" });
    assert.throws(() => updateGroup(db, g.id, { projectId: "p2" }), /already used/);
    assert.throws(() => updateGroup(db, g.id, { projectId: "nope" }), /Project not found/);

    const other = createGroup(db, { code: "API", projectId: "p1" });
    assert.equal(updateGroup(db, other.id, { projectId: "p2" }).projectId, "p2");
    assert.equal(updateGroup(db, other.id, { projectId: null }).projectId, null);
  });

  t("updateGroup refuses a project its members are not in; going global is fine", (db) => {
    const g = createGroup(db, { code: "X" });
    addCard(db, "c1", g.id, "p1");
    assert.throws(
      () => updateGroup(db, g.id, { projectId: "p2" }),
      (err: unknown) => err instanceof CardGroupError && err.kind === "conflict"
    );
    assert.equal(updateGroup(db, g.id, { projectId: "p1" }).projectId, "p1");
    assert.equal(updateGroup(db, g.id, { projectId: "" }).projectId, null);
  });

  t("deleteGroup releases its members, clears their position and drops the row", (db) => {
    const g = createGroup(db, { code: "DEL", projectId: "p1" });
    const keep = createGroup(db, { code: "KEEP", projectId: "p1" });
    addCard(db, "a", g.id, "p1", 1);
    addCard(db, "b", g.id, "p1", 2);
    addCard(db, "k", keep.id, "p1", 1);

    const { group, releasedCards } = deleteGroup(db, g.id);
    assert.equal(group.code, "DEL");
    assert.equal(releasedCards, 2);
    const rows = db.prepare(`SELECT id, group_id, group_order FROM cards ORDER BY id`).all().map(plain);
    assert.deepEqual(rows, [
      { id: "a", group_id: null, group_order: null },
      { id: "b", group_id: null, group_order: null },
      { id: "k", group_id: keep.id, group_order: 1 },
    ]);
    assert.equal(listGroups(db).length, 1);
    assert.throws(
      () => deleteGroup(db, g.id),
      (err: unknown) => err instanceof CardGroupError && err.kind === "not_found"
    );
  });

  t("assertGroupAssignable blocks unknown ids and another project's group", (db) => {
    const p1 = createGroup(db, { code: "A", projectId: "p1" });
    const global = createGroup(db, { code: "G" });
    assert.doesNotThrow(() => assertGroupAssignable(db, null, "p1"));
    assert.doesNotThrow(() => assertGroupAssignable(db, normalizeGroupId(""), "p1"));
    assert.doesNotThrow(() => assertGroupAssignable(db, p1.id, "p1"));
    assert.doesNotThrow(() => assertGroupAssignable(db, global.id, "p2"));
    assert.throws(() => assertGroupAssignable(db, "missing", "p1"), /Group not found/);
    assert.throws(() => assertGroupAssignable(db, p1.id, "p2"), /another project/);
  });

  t("moveCardInChain: a no-op move writes nothing, a real one rewrites 1..N", (db) => {
    const g = createGroup(db, { code: "CH", projectId: "p1" });
    addCard(db, "a", g.id, "p1", 10);
    addCard(db, "b", g.id, "p1", 20);

    const same = moveCardInChain(db, "b", "a", g.id);
    assert.equal(same.changed, false);
    assert.deepEqual(same.order, [
      { id: "a", groupOrder: 10 },
      { id: "b", groupOrder: 20 },
    ]);
    const orders = db.prepare(`SELECT group_order AS o FROM cards ORDER BY id`).all().map(plain);
    assert.deepEqual(orders, [{ o: 10 }, { o: 20 }]);

    const moved = moveCardInChain(db, "b", null, g.id);
    assert.equal(moved.changed, true);
    assert.deepEqual(moved.order, [
      { id: "b", groupOrder: 1 },
      { id: "a", groupOrder: 2 },
    ]);
    assert.throws(() => moveCardInChain(db, "a", null, "other"), /not in this group/);
  });
}

test("a database without card_groups gets an update-the-app error, not a SQL one", () => {
  const db = openDatabase(":memory:");
  assert.throws(() => listGroups(db), /Update the Ideafy app/);
});
