import test from "node:test";
import assert from "node:assert/strict";

import * as todayNs from "../../lib/today-activity";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { groupTodayActivity } = interop(todayNs);

const projectOf = new Map<string, string | null>([
  ["a", "p1"],
  ["b", "p1"],
  ["c", "p2"],
]);

test("one entry per card, newest touch first", () => {
  const result = groupTodayActivity({
    chats: [
      { cardId: "a", sectionType: "opinion", count: 6, lastAt: "2026-09-30T10:00:00.000Z" },
      { cardId: "b", sectionType: "tests", count: 1, lastAt: "2026-09-30T12:00:00.000Z" },
    ],
    runs: [{ cardId: "a", runKind: "evaluate", at: "2026-09-30T09:00:00.000Z" }],
    terminals: [],
    completions: [],
    projectOf,
  });

  assert.deepEqual(
    result.map((c) => c.cardId),
    ["b", "a"]
  );
  assert.deepEqual(
    result[1].chips.map((c) => c.label),
    ["Evaluate", "AI Opinion · 6 messages"]
  );
  assert.equal(result[0].chips[0].label, "Tests · 1 message");
  assert.equal(result[1].lastSection, "opinion");
});

test("repeat runs fold into one chip with a count", () => {
  const [card] = groupTodayActivity({
    chats: [],
    runs: [
      { cardId: "a", runKind: "implementation", at: "2026-09-30T09:00:00.000Z" },
      { cardId: "a", runKind: "implementation", at: "2026-09-30T11:00:00.000Z" },
    ],
    terminals: [],
    completions: [{ cardId: "a", at: "2026-09-30T12:00:00.000Z" }],
    projectOf,
  });

  assert.deepEqual(
    card.chips.map((c) => c.label),
    ["Completed", "Implementation × 2"]
  );
  assert.equal(card.steps.length, 3);
  assert.equal(card.steps[0].label, "Implementation run");
  assert.equal(card.steps[2].label, "Completed");
  // Completing adds no tab of its own; the last run's tab stays the target.
  assert.equal(card.lastSection, "solution");
});

test("terminal sessions are a chip, never a run count", () => {
  const [card] = groupTodayActivity({
    chats: [],
    runs: [],
    terminals: [
      { cardId: "c", at: "2026-09-30T09:00:00.000Z" },
      { cardId: "c", at: "2026-09-30T10:00:00.000Z" },
    ],
    completions: [],
    projectOf,
  });

  assert.deepEqual(
    card.chips.map((c) => c.label),
    ["Terminal session"]
  );
  assert.equal(card.projectId, "p2");
  assert.equal(card.lastSection, null);
});

test("unknown run kinds show under their raw name", () => {
  const [card] = groupTodayActivity({
    chats: [],
    runs: [{ cardId: "a", runKind: "generate", at: "2026-09-30T09:00:00.000Z" }],
    terminals: [],
    completions: [],
    projectOf,
  });
  assert.equal(card.chips[0].label, "generate");
});

test("rows whose card no longer exists are dropped", () => {
  const result = groupTodayActivity({
    chats: [{ cardId: "gone", sectionType: "detail", count: 2, lastAt: "2026-09-30T09:00:00.000Z" }],
    runs: [{ cardId: "gone", runKind: "evaluate", at: "2026-09-30T09:00:00.000Z" }],
    terminals: [],
    completions: [],
    projectOf,
  });
  assert.deepEqual(result, []);
});
