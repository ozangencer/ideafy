import test from "node:test";
import assert from "node:assert/strict";

import * as groupNs from "../../lib/card-group";
import type { Card, CardGroup, Project, Status } from "../../lib/types";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { summarizeCardGroups, summarizeChainsForView, chainPillWindow, chainOrderAnomaly } =
  interop(groupNs);

const projects: Pick<Project, "id" | "mode">[] = [
  { id: "dev", mode: "development" },
  { id: "work", mode: "work" },
];

function group(id: string, projectId: string | null = null): CardGroup {
  return { id, projectId, code: id.toUpperCase(), name: `Group ${id}`, color: null, createdAt: "" };
}

let taskNumber = 0;
function card(
  groupId: string,
  status: Status,
  extra: Partial<Card> = {}
): Card {
  taskNumber += 1;
  return {
    id: `${groupId}-${taskNumber}`,
    title: `Card ${taskNumber}`,
    status,
    groupId,
    projectId: "dev",
    taskNumber,
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...extra,
  } as Card;
}

const view = (cards: Card[], groups: CardGroup[], opts: Partial<Parameters<typeof summarizeChainsForView>[1]> = {}) =>
  summarizeChainsForView(summarizeCardGroups(cards, groups).values(), {
    workspace: "development",
    projects,
    ...opts,
  });

test("withdrawn members leave the denominator but stay counted", () => {
  const cards = [
    card("a", "completed"),
    card("a", "completed"),
    card("a", "withdrawn"),
    card("a", "completed"),
  ];
  const summary = summarizeCardGroups(cards, [group("a")]).get("a")!;
  assert.equal(summary.done, 3);
  assert.equal(summary.withdrawn, 1);
  assert.equal(summary.total - summary.withdrawn, 3);
  assert.equal(summary.isComplete, true);
});

test("finished chains split off; open ones sort by last move", () => {
  const cards = [
    card("old", "backlog", { updatedAt: "2026-09-01T00:00:00.000Z" }),
    card("new", "backlog", { updatedAt: "2026-09-01T00:00:00.000Z" }),
    card("new", "test", { updatedAt: "2026-10-02T00:00:00.000Z" }),
    card("done", "completed", { updatedAt: "2026-10-03T00:00:00.000Z" }),
  ];
  const { open, finished } = view(cards, [group("old"), group("new"), group("done")]);
  assert.deepEqual(open.map((s) => s.group.id), ["new", "old"]);
  assert.deepEqual(finished.map((s) => s.group.id), ["done"]);
  assert.equal(open[0].inTest, 1);
  assert.equal(open[0].lastMovedAt, "2026-10-02T00:00:00.000Z");
});

test("a project-less group shows in every workspace that holds a member", () => {
  const cards = [card("x", "backlog", { projectId: "dev" }), card("x", "backlog", { projectId: "work" })];
  const groups = [group("x")];
  assert.equal(view(cards, groups, { workspace: "development" }).open.length, 1);
  assert.equal(view(cards, groups, { workspace: "work" }).open.length, 1);

  const devOnly = [card("y", "backlog", { projectId: "dev" })];
  assert.equal(view(devOnly, [group("y")], { workspace: "work" }).open.length, 0);
});

test("a project's group follows its project, not its members", () => {
  const cards = [card("p", "backlog", { projectId: "work" })];
  const groups = [group("p", "dev")];
  assert.equal(view(cards, groups, { workspace: "development" }).open.length, 1);
  assert.equal(view(cards, groups, { projectId: "work", workspace: "work" }).open.length, 0);
});

test("the query keeps whole chains and matches code, name or member title", () => {
  const cards = [card("q", "backlog", { title: "Score parser" }), card("q", "backlog")];
  const groups = [group("q")];
  const hit = view(cards, groups, { query: "parser" }).open;
  assert.equal(hit.length, 1);
  assert.equal(hit[0].total, 2);
  assert.equal(view(cards, groups, { query: "Q" }).open.length, 1);
  assert.equal(view(cards, groups, { query: "nothing" }).open.length, 0);
});

test("the pill window starts at next and follows chain order, not status", () => {
  const cards = [
    card("w", "completed"),
    card("w", "backlog"),
    card("w", "test"),
    card("w", "withdrawn"),
    card("w", "progress"),
    card("w", "ideation"),
    card("w", "backlog"),
  ];
  const summary = summarizeCardGroups(cards, [group("w")]).get("w")!;
  const { pills, more } = chainPillWindow(summary, 3);
  assert.deepEqual(pills.map((c) => c.status), ["backlog", "test", "progress"]);
  assert.equal(more, 2);
});

test("a later card further along than next is flagged; parallel progress is not", () => {
  const ahead = [card("o", "completed"), card("o", "ideation"), card("o", "test")];
  const flagged = chainOrderAnomaly(summarizeCardGroups(ahead, [group("o")]).get("o")!);
  assert.equal(flagged?.status, "test");

  const parallel = [card("r", "progress"), card("r", "progress"), card("r", "backlog")];
  assert.equal(chainOrderAnomaly(summarizeCardGroups(parallel, [group("r")]).get("r")!), null);
});
