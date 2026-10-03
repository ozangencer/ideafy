import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, transaction, type Db } from "../db.js";
import {
  CardGroupError,
  getChainForCard,
  listGroupsWithChains,
  moveCardInChain,
} from "../card-groups.js";
import { buildChainImplementationNote } from "../serialize-card.js";
import { buildChainContext, CHAIN_IMPLEMENTATION_RULE } from "../shared.js";

// A card's place in its chain over MCP: get_card's `chain`, list_groups'
// members and next, and update_card's afterCardId.

function makeDb({ groupOrder = true } = {}) {
  const db = openDatabase(":memory:");
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, id_prefix TEXT NOT NULL);
    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      group_id TEXT,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      task_number INTEGER,
      updated_at TEXT NOT NULL DEFAULT 'then'
      ${groupOrder ? ", group_order INTEGER" : ""}
    );
    CREATE TABLE card_groups (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT,
      created_at TEXT NOT NULL
    );
    INSERT INTO projects (id, id_prefix) VALUES ('p1', 'IDE'), ('p2', 'KAN');
    INSERT INTO card_groups (id, project_id, code, name, created_at) VALUES
      ('g1', 'p1', 'WORK', 'Work workspace', 'now'),
      ('g2', NULL, 'SHARED', 'Shared', 'now');
  `);
  if (groupOrder) {
    // Same trigger as drizzle/0016: a card changing groups loses its position.
    db.exec(`
      CREATE TRIGGER cards_group_order_reset AFTER UPDATE OF group_id ON cards
      WHEN OLD.group_id IS NOT NEW.group_id
      BEGIN UPDATE cards SET group_order = NULL WHERE id = NEW.id; END;
    `);
  }
  return db;
}

function addCard(
  db: Db,
  id: string,
  opts: { group?: string | null; task?: number | null; status?: string; order?: number | null; project?: string } = {}
) {
  const hasOrder = (db.prepare(`PRAGMA table_info(cards)`).all() as Array<{ name: string }>).some(
    (c) => c.name === "group_order"
  );
  const cols = ["id", "project_id", "group_id", "title", "status", "task_number"];
  const vals: unknown[] = [
    id,
    opts.project ?? "p1",
    opts.group === undefined ? "g1" : opts.group,
    `Title ${id}`,
    opts.status ?? "backlog",
    opts.task === undefined ? null : opts.task,
  ];
  if (hasOrder) {
    cols.push("group_order");
    vals.push(opts.order ?? null);
  }
  db.prepare(`INSERT INTO cards (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...vals);
}

const ids = (refs: Array<{ displayId: string | null; title: string }>) =>
  refs.map((r) => r.displayId ?? r.title);

test("buildChainContext places the card and names the first open member as next", () => {
  const members = [
    { id: "a", taskNumber: 1, status: "completed" },
    { id: "b", taskNumber: 2, status: "withdrawn" },
    { id: "c", taskNumber: 3, status: "test" },
    { id: "d", taskNumber: 4, status: "backlog" },
  ];
  const ctx = buildChainContext(members, "d", (m) => ({ displayId: m.id, title: m.id, status: m.status }));
  assert.ok(ctx);
  assert.equal(ctx.position, 4);
  assert.equal(ctx.total, 4);
  assert.deepEqual(ids(ctx.predecessors), ["a", "b", "c"]);
  assert.deepEqual(ctx.successors, []);
  // Human Test is not finished: it is the chain's next card, not this one.
  assert.equal(ctx.next?.displayId, "c");
  assert.equal(buildChainContext(members, "zzz", (m) => ({ displayId: m.id, title: m.id, status: m.status })), null);
});

test("getChainForCard is null for a card in no group", () => {
  const db = makeDb();
  addCard(db, "solo", { group: null, task: 1 });
  assert.equal(getChainForCard(db, { id: "solo", groupId: null }), null);
});

test("getChainForCard orders placed members first, then by task number, drafts last", () => {
  const db = makeDb();
  addCard(db, "c10", { task: 10 });
  addCard(db, "c20", { task: 20, order: 1 });
  addCard(db, "c30", { task: 30, status: "withdrawn" });
  addCard(db, "draft", { task: null });

  const chain = getChainForCard(db, { id: "c10", groupId: "g1" });
  assert.ok(chain);
  assert.equal(chain.groupCode, "WORK");
  assert.equal(chain.groupName, "Work workspace");
  assert.equal(chain.position, 2);
  assert.equal(chain.total, 4);
  assert.deepEqual(ids(chain.predecessors), ["IDE-20"]);
  assert.deepEqual(ids(chain.successors), ["IDE-30", "Title draft"]);
  assert.equal(chain.successors[1].displayId, null);
  assert.equal(chain.next?.displayId, "IDE-20");
});

test("a withdrawn predecessor stays in the list but is never next", () => {
  const db = makeDb();
  addCard(db, "a", { task: 1, status: "withdrawn" });
  addCard(db, "b", { task: 2, status: "progress" });
  const chain = getChainForCard(db, { id: "b", groupId: "g1" });
  assert.deepEqual(ids(chain!.predecessors), ["IDE-1"]);
  assert.equal(chain!.predecessors[0].status, "withdrawn");
  assert.equal(chain!.next?.displayId, "IDE-2");
});

test("a DB without group_order reads the chain by task number", () => {
  const db = makeDb({ groupOrder: false });
  addCard(db, "b", { task: 2 });
  addCard(db, "a", { task: 1 });
  const chain = getChainForCard(db, { id: "b", groupId: "g1" });
  assert.equal(chain?.position, 2);
  assert.deepEqual(ids(chain!.predecessors), ["IDE-1"]);
});

test("listGroupsWithChains gives each group its ordered members and next, prefixes per card", () => {
  const db = makeDb();
  addCard(db, "a", { task: 1, status: "completed" });
  addCard(db, "b", { task: 2, order: 1 });
  addCard(db, "c", { task: 3 });
  addCard(db, "k", { group: "g2", task: 7, project: "p2" });
  addCard(db, "i", { group: "g2", task: 9 });

  const groups = listGroupsWithChains(db);
  const work = groups.find((g) => g.code === "WORK")!;
  assert.equal(work.memberCount, 3);
  assert.deepEqual(
    work.members.map((m) => [m.displayId, m.position]),
    [["IDE-2", 1], ["IDE-1", 2], ["IDE-3", 3]]
  );
  assert.equal(work.next?.displayId, "IDE-2");

  const shared = groups.find((g) => g.code === "SHARED")!;
  assert.deepEqual(shared.members.map((m) => m.displayId), ["KAN-7", "IDE-9"]);
});

test("listGroupsWithChains: a finished chain has no next, an empty group no members", () => {
  const db = makeDb();
  addCard(db, "a", { task: 1, status: "completed" });
  addCard(db, "b", { task: 2, status: "withdrawn" });
  const groups = listGroupsWithChains(db, "p1");
  assert.equal(groups.find((g) => g.code === "WORK")!.next, null);
  assert.deepEqual(groups.find((g) => g.code === "SHARED")!.members, []);
});

const order = (db: Db) =>
  (db.prepare(`SELECT id FROM cards WHERE group_id = 'g1' ORDER BY group_order`).all() as Array<{ id: string }>).map(
    (r) => r.id
  );

test("moveCardInChain writes 1..N for the whole chain and leaves updated_at alone", () => {
  const db = makeDb();
  addCard(db, "a", { task: 1 });
  addCard(db, "b", { task: 2, status: "completed" });
  addCard(db, "c", { task: 3 });

  assert.deepEqual(moveCardInChain(db, "c", "a"), { position: 2, total: 3 });
  assert.deepEqual(order(db), ["a", "c", "b"]);

  assert.deepEqual(moveCardInChain(db, "b", null), { position: 1, total: 3 });
  assert.deepEqual(order(db), ["b", "a", "c"]);

  const stamps = db.prepare(`SELECT DISTINCT updated_at AS u FROM cards`).all() as Array<{ u: string }>;
  assert.deepEqual(stamps.map((s) => s.u), ["then"]);
});

test("moveCardInChain rejects itself, another group's card, a groupless card and an old DB", () => {
  const db = makeDb();
  addCard(db, "a", { task: 1 });
  addCard(db, "b", { task: 2 });
  addCard(db, "x", { group: "g2", task: 3 });
  addCard(db, "solo", { group: null, task: 4 });

  assert.throws(() => moveCardInChain(db, "a", "a"), CardGroupError);
  assert.throws(() => moveCardInChain(db, "a", "x"), /not in this card's group/);
  assert.throws(() => moveCardInChain(db, "solo", "a"), /in no group/);
  // Nothing was written by any of the rejected moves.
  const placed = db.prepare(`SELECT COUNT(*) AS n FROM cards WHERE group_order IS NOT NULL`).get() as { n: number };
  assert.equal(placed.n, 0);

  const old = makeDb({ groupOrder: false });
  addCard(old, "a", { task: 1 });
  addCard(old, "b", { task: 2 });
  assert.throws(() => moveCardInChain(old, "a", "b"), /Update the Ideafy app/);
});

test("joining a group and moving in the same transaction places the card in the new chain", () => {
  const db = makeDb();
  addCard(db, "a", { task: 1 });
  addCard(db, "b", { task: 2 });
  addCard(db, "c", { task: 3 });
  addCard(db, "x", { group: "g2", task: 4, order: 1 });

  // update_card's order: the group write first (the trigger drops x's old
  // position), then the move computed in g1.
  const placed = transaction(db, () => {
    db.prepare(`UPDATE cards SET group_id = 'g1' WHERE id = 'x'`).run();
    return moveCardInChain(db, "x", "a");
  });
  assert.deepEqual(placed, { position: 2, total: 4 });
  assert.deepEqual(order(db), ["a", "x", "b", "c"]);

  // A rejected move rolls the group write back with it.
  assert.throws(() =>
    transaction(db, () => {
      db.prepare(`UPDATE cards SET group_id = 'g2' WHERE id = 'c'`).run();
      moveCardInChain(db, "c", "a");
    })
  );
  assert.equal((db.prepare(`SELECT group_id AS g FROM cards WHERE id = 'c'`).get() as { g: string }).g, "g1");
});

test("get_card adds the chain implementation note only to a planned chain card in progress", () => {
  const db = makeDb();
  addCard(db, "a", { task: 1, status: "completed" });
  addCard(db, "b", { task: 2, status: "progress" });
  addCard(db, "solo", { group: null, task: 3, status: "progress" });
  const chain = getChainForCard(db, { id: "b", groupId: "g1" });
  const plan = "<p>Plan</p>";

  const note = buildChainImplementationNote({ status: "progress", solutionSummary: plan }, chain);
  assert.ok(note?.startsWith("If you are implementing this card:"));
  assert.ok(note?.includes(CHAIN_IMPLEMENTATION_RULE));

  // No chain, no plan or not being built: the response reads as before.
  const soloChain = getChainForCard(db, { id: "solo", groupId: null });
  assert.equal(buildChainImplementationNote({ status: "progress", solutionSummary: plan }, soloChain), null);
  assert.equal(buildChainImplementationNote({ status: "progress", solutionSummary: "<p></p>" }, chain), null);
  assert.equal(buildChainImplementationNote({ status: "progress", solutionSummary: null }, chain), null);
  for (const status of ["backlog", "bugs", "test", "completed"]) {
    assert.equal(buildChainImplementationNote({ status, solutionSummary: plan }, chain), null);
  }
});
