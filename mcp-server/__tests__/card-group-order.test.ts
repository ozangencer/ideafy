import test from "node:test";
import assert from "node:assert/strict";

import * as cardGroupNs from "../../lib/card-group";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { summarizeCardGroups, buildColumnRows } = interop(cardGroupNs);

type Card = Parameters<typeof summarizeCardGroups>[0][number];
type CardGroup = Parameters<typeof summarizeCardGroups>[1][number];

const GROUP: CardGroup = {
  id: "g1",
  projectId: "p1",
  code: "WORK",
  name: "Work workspace",
  color: null,
  createdAt: "2026-09-01T00:00:00.000Z",
};

function makeCard(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    title: id,
    description: "",
    solutionSummary: "",
    testScenarios: "",
    aiOpinion: "",
    aiVerdict: null,
    status: "backlog",
    complexity: "medium",
    priority: "medium",
    projectFolder: "/tmp/ideafy",
    projectId: "p1",
    groupId: "g1",
    taskNumber: null,
    gitBranchName: null,
    gitBranchStatus: null,
    gitWorktreePath: null,
    gitWorktreeStatus: null,
    devServerPort: null,
    devServerPid: null,
    rebaseConflict: null,
    conflictFiles: null,
    processingType: null,
    aiPlatform: null,
    useWorktree: null,
    outputPaths: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function summaryOf(cards: Card[]) {
  const summary = summarizeCardGroups(cards, [GROUP]).get("g1");
  assert.ok(summary);
  return summary;
}

test("next is the lowest-numbered open member, not the one furthest along", () => {
  // The screenshot's case: 336 went ahead to test, 335 is still in backlog.
  const summary = summaryOf([
    makeCard("ide-336", { taskNumber: 336, status: "test" }),
    makeCard("ide-331", { taskNumber: 331, status: "completed" }),
    makeCard("ide-358", { taskNumber: 358 }),
    makeCard("ide-335", { taskNumber: 335 }),
  ]);
  assert.deepEqual(
    summary.members.map((c) => c.id),
    ["ide-331", "ide-335", "ide-336", "ide-358"]
  );
  assert.equal(summary.nextCard?.id, "ide-335");
});

test("a member without a number sorts last instead of taking the next slot", () => {
  const summary = summaryOf([
    makeCard("draft", { taskNumber: null }),
    makeCard("ide-12", { taskNumber: 12 }),
  ]);
  assert.deepEqual(summary.members.map((c) => c.id), ["ide-12", "draft"]);
  assert.equal(summary.nextCard?.id, "ide-12");
});

test("withdrawn members are skipped when picking next", () => {
  const summary = summaryOf([
    makeCard("ide-1", { taskNumber: 1, status: "withdrawn" }),
    makeCard("ide-2", { taskNumber: 2, status: "completed" }),
    makeCard("ide-3", { taskNumber: 3 }),
  ]);
  assert.equal(summary.nextCard?.id, "ide-3");
  assert.equal(summary.isComplete, false);
});

test("an open group row lists its column members in chain order", () => {
  const cards = [
    makeCard("ide-5", { taskNumber: 5, priority: "low" }),
    makeCard("loose", { groupId: null, taskNumber: 9, priority: "high" }),
    makeCard("ide-7", { taskNumber: 7, priority: "high" }),
    makeCard("ide-6", { taskNumber: 6, priority: "medium" }),
  ];
  // The column's own sort: priority first, which puts 7 ahead of 5.
  const columnSorted = [cards[1], cards[2], cards[3], cards[0]];
  const rows = buildColumnRows(columnSorted, summarizeCardGroups(cards, [GROUP]));

  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, "card");
  const groupRow = rows[1];
  assert.equal(groupRow.kind, "group");
  if (groupRow.kind !== "group") return;
  // The row keeps its place in the column; its members follow the chain.
  assert.deepEqual(
    groupRow.columnMembers.map((c) => c.id),
    ["ide-5", "ide-6", "ide-7"]
  );
});
