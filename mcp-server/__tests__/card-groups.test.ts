import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../db.js";
import {
  CardGroupError,
  assertGroupAssignable,
  createGroup,
  listGroups,
  normalizeGroupCode,
  updateGroup,
} from "../card-groups.js";

function makeDb() {
  const db = openDatabase(":memory:");
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE cards (id TEXT PRIMARY KEY, project_id TEXT, group_id TEXT);
    CREATE TABLE card_groups (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT,
      created_at TEXT NOT NULL
    );
    INSERT INTO projects (id) VALUES ('p1'), ('p2');
  `);
  return db;
}

test("normalizeGroupCode matches the card modal picker", () => {
  assert.equal(normalizeGroupCode(" mobile app!"), "MOBILE");
  assert.equal(normalizeGroupCode("ios-2"), "IOS2");
  assert.equal(normalizeGroupCode("---"), "");
});

test("createGroup writes a normalised row and defaults the name to the code", () => {
  const db = makeDb();
  const g = createGroup(db, { code: "mob", projectId: "p1" });
  assert.equal(g.code, "MOB");
  assert.equal(g.name, "MOB");
  assert.equal(g.memberCount, 0);
  const row = db.prepare(`SELECT code, name, project_id FROM card_groups WHERE id = ?`).get(g.id);
  // node:sqlite rows have a null prototype; spread to compare as a plain object.
  assert.deepEqual({ ...(row as object) }, { code: "MOB", name: "MOB", project_id: "p1" });
});

test("createGroup rejects an empty code and an unknown project", () => {
  const db = makeDb();
  assert.throws(() => createGroup(db, { code: "!!" }), CardGroupError);
  assert.throws(() => createGroup(db, { code: "OK", projectId: "nope" }), /Project not found/);
});

test("a code clashes within the project and with global groups, not across projects", () => {
  const db = makeDb();
  const first = createGroup(db, { code: "MOBILE", projectId: "p1" });
  assert.throws(() => createGroup(db, { code: "mobile", projectId: "p1" }), new RegExp(first.id));
  // Another project may reuse it.
  assert.doesNotThrow(() => createGroup(db, { code: "MOBILE", projectId: "p2" }));
  // A global group is offered everywhere, so it clashes with any project's code.
  assert.throws(() => createGroup(db, { code: "MOBILE" }), CardGroupError);
  createGroup(db, { code: "SHARED" });
  assert.throws(() => createGroup(db, { code: "SHARED", projectId: "p1" }), CardGroupError);
});

test("listGroups with a project returns its groups plus global ones, with member counts", () => {
  const db = makeDb();
  const own = createGroup(db, { code: "A", projectId: "p1" });
  createGroup(db, { code: "B", projectId: "p2" });
  createGroup(db, { code: "C" });
  db.prepare(`INSERT INTO cards (id, project_id, group_id) VALUES ('c1', 'p1', ?), ('c2', 'p1', ?)`).run(own.id, own.id);

  const forP1 = listGroups(db, "p1");
  assert.deepEqual(forP1.map((g) => g.code), ["A", "C"]);
  assert.equal(forP1[0].memberCount, 2);
  assert.equal(listGroups(db).length, 3);
});

test("updateGroup renames, refuses an empty update and a clashing code", () => {
  const db = makeDb();
  const a = createGroup(db, { code: "A", projectId: "p1" });
  createGroup(db, { code: "B", projectId: "p1" });
  assert.equal(updateGroup(db, a.id, { name: "Mobile app" }).name, "Mobile app");
  assert.throws(() => updateGroup(db, a.id, {}), /nothing to update/);
  assert.throws(() => updateGroup(db, a.id, { code: "b" }), /already used/);
  assert.throws(() => updateGroup(db, "missing", { name: "x" }), /Group not found/);
});

test("assertGroupAssignable blocks unknown ids and another project's group", () => {
  const db = makeDb();
  const p1 = createGroup(db, { code: "A", projectId: "p1" });
  const global = createGroup(db, { code: "G" });
  assert.doesNotThrow(() => assertGroupAssignable(db, null, "p1"));
  assert.doesNotThrow(() => assertGroupAssignable(db, p1.id, "p1"));
  assert.doesNotThrow(() => assertGroupAssignable(db, global.id, "p2"));
  assert.throws(() => assertGroupAssignable(db, "missing", "p1"), /Group not found/);
  assert.throws(() => assertGroupAssignable(db, p1.id, "p2"), /another project/);
});

test("a database without card_groups gets an update-the-app error, not a SQL one", () => {
  const db = openDatabase(":memory:");
  assert.throws(() => listGroups(db), /Update the Ideafy app/);
});
