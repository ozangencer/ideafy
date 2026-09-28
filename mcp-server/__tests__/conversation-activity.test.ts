import test from "node:test";
import assert from "node:assert/strict";

import * as activityNs from "../../lib/conversation-activity";
import type { ConversationActivityEntry } from "../../lib/types";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { appendActivity, sealActivity, thinkingTail, DEFAULT_ACTIVITY_CAP } =
  interop(activityNs);

const thinking = (content: string): ConversationActivityEntry => ({ type: "thinking", content });
const toolUse = (name: string): ConversationActivityEntry => ({
  type: "tool_use",
  content: `Using: ${name}`,
});

function reduce(events: ConversationActivityEntry[], max?: number): ConversationActivityEntry[] {
  return events.reduce<ConversationActivityEntry[]>(
    (log, entry) => appendActivity(log, entry, max),
    [],
  );
}

// IDE-355: the screenshot on the card. Claude streams `thinking_delta`s with
// --include-partial-messages, and the strip showed "u / ~30 saniye s / ürec /
// ek." as four separate thoughts.
test("consecutive thinking deltas grow one row, whitespace intact", () => {
  const log = reduce([
    thinking("Bu işlem yaklaşık"),
    thinking(" ~30 saniye s"),
    thinking("ürec"),
    thinking("ek."),
  ]);

  assert.equal(log.length, 1);
  assert.equal(log[0].content, "Bu işlem yaklaşık ~30 saniye sürecek.");
  assert.equal(log[0].open, true);
});

test("a tool call ends the thought; the next delta starts a new row", () => {
  const log = reduce([
    thinking("Önce dosyaya bakayım"),
    toolUse("Read"),
    thinking("Şimdi düzeltiyorum"),
  ]);

  assert.deepEqual(
    log.map((e) => [e.type, e.content, e.open ?? false]),
    [
      ["thinking", "Önce dosyaya bakayım", false],
      ["tool_use", "Using: Read", false],
      ["thinking", "Şimdi düzeltiyorum", true],
    ],
  );
});

test("sealActivity closes the open row so later deltas do not glue onto it", () => {
  const open = reduce([thinking("Plan hazır")]);
  const sealed = sealActivity(open);

  assert.notEqual(sealed, open);
  assert.equal(sealed[0].open, undefined);

  const next = appendActivity(sealed, thinking("İkinci düşünce"));
  assert.equal(next.length, 2);
  assert.equal(next[1].content, "İkinci düşünce");
});

test("sealActivity returns the same array when nothing is open", () => {
  const empty: ConversationActivityEntry[] = [];
  assert.equal(sealActivity(empty), empty);

  const afterTool = reduce([thinking("x"), toolUse("Bash")]);
  assert.equal(sealActivity(afterTool), afterTool);

  const sealed = sealActivity(reduce([thinking("y")]));
  assert.equal(sealActivity(sealed), sealed);
});

test("the cap keeps the newest rows and merging never evicts", () => {
  const log = reduce([
    thinking("a"),
    toolUse("1"),
    thinking("b"),
    toolUse("2"),
    thinking("c"),
    toolUse("3"),
    thinking("d"),
    toolUse("4"),
    thinking("e"),
    thinking(" grows"),
  ]);

  // Nine rows were pushed; the cap keeps c, 3, d, 4, e and the merge only
  // grows the last one instead of pushing another row past the cap.
  assert.equal(log.length, DEFAULT_ACTIVITY_CAP);
  assert.equal(log[0].content, "c");
  assert.equal(log[log.length - 1].content, "e grows");

  const uncapped = reduce(
    Array.from({ length: 12 }, (_, i) => (i % 2 ? toolUse(String(i)) : thinking(String(i)))),
    Infinity,
  );
  assert.equal(uncapped.length, 12);
});

test("whitespace-only deltas only count while a row is open", () => {
  const empty: ConversationActivityEntry[] = [];
  assert.equal(appendActivity(empty, thinking("   ")), empty);
  assert.equal(appendActivity(empty, thinking("")), empty);

  const afterTool = reduce([toolUse("Bash")]);
  assert.equal(appendActivity(afterTool, thinking("\n")), afterTool);

  const open = reduce([thinking("saniye"), thinking(" "), thinking("sürecek")]);
  assert.equal(open[0].content, "saniye sürecek");
});

test("thinkingTail keeps short text and shows the tail of long text", () => {
  assert.equal(thinkingTail("  kısa düşünce \n"), "kısa düşünce");

  const long = "x".repeat(300) + " son kısım";
  const tail = thinkingTail(long, 20);
  assert.equal(tail, "…" + long.slice(-20));
  assert.ok(tail.endsWith(" son kısım"));

  assert.equal(thinkingTail("tam 5", 5), "tam 5");
});
