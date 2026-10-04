import test from "node:test";
import assert from "node:assert/strict";

import * as sortNs from "../../lib/board-sort";
import type { Card } from "../../lib/types";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { sortCards, sortIdeationCards } = interop(sortNs);

function card(id: string, createdAt: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    title: `Card ${id}`,
    status: "ideation",
    priority: "medium",
    complexity: "medium",
    aiOpinion: "",
    createdAt,
    updatedAt: createdAt,
    ...extra,
  } as Card;
}

const ids = (cards: Card[]) => cards.map((c) => c.id);

test("an unevaluated low-priority card sits above an evaluated high one", () => {
  const evaluated = card("old", "2026-10-01T00:00:00.000Z", {
    priority: "high",
    complexity: "low",
    aiOpinion: "<p>[VERDICT: yes]</p>",
  });
  const fresh = card("new", "2026-10-02T00:00:00.000Z", { priority: "low" });

  assert.deepEqual(ids(sortIdeationCards([evaluated, fresh])), ["new", "old"]);
});

test("among unevaluated cards the newest comes first, whatever its priority", () => {
  const older = card("older", "2026-10-01T00:00:00.000Z", { priority: "high" });
  const newer = card("newer", "2026-10-03T00:00:00.000Z", { priority: "low" });

  assert.deepEqual(ids(sortIdeationCards([older, newer])), ["newer", "older"]);
});

test("a whitespace-only opinion counts as unevaluated", () => {
  const blank = card("blank", "2026-10-01T00:00:00.000Z", { aiOpinion: "  \n " });
  const evaluated = card("done", "2026-10-02T00:00:00.000Z", {
    priority: "high",
    aiOpinion: "<p>ok</p>",
  });

  assert.deepEqual(ids(sortIdeationCards([evaluated, blank])), ["blank", "done"]);
});

test("evaluated cards keep priority → complexity, newest breaks the tie", () => {
  const opinion = "<p>ok</p>";
  const cards = [
    card("tie-old", "2026-10-01T00:00:00.000Z", { aiOpinion: opinion }),
    card("high", "2026-09-01T00:00:00.000Z", { priority: "high", aiOpinion: opinion }),
    card("tie-new", "2026-10-02T00:00:00.000Z", { aiOpinion: opinion }),
    card("easy", "2026-09-02T00:00:00.000Z", { complexity: "low", aiOpinion: opinion }),
  ];

  assert.deepEqual(ids(sortIdeationCards(cards)), ["high", "easy", "tie-new", "tie-old"]);
});

test("the order does not depend on the input order", () => {
  const cards = [
    card("a", "2026-10-01T00:00:00.000Z"),
    card("b", "2026-10-02T00:00:00.000Z", { aiOpinion: "<p>x</p>" }),
    card("c", "2026-10-03T00:00:00.000Z"),
    card("d", "2026-10-04T00:00:00.000Z", { aiOpinion: "<p>x</p>" }),
  ];

  assert.deepEqual(
    ids(sortIdeationCards(cards)),
    ids(sortIdeationCards([...cards].reverse()))
  );
  assert.deepEqual(ids(sortCards(cards)), ids(sortCards([...cards].reverse())));
});

test("other columns break a priority/complexity tie by newest", () => {
  const older = card("older", "2026-10-01T00:00:00.000Z", { status: "backlog" });
  const newer = card("newer", "2026-10-02T00:00:00.000Z", { status: "backlog" });

  assert.deepEqual(ids(sortCards([older, newer])), ["newer", "older"]);
});
