import test from "node:test";
import assert from "node:assert/strict";

import * as focusNs from "../../lib/board-focus";
import type { ActivityEvent, ActivityType, Card, Status } from "../../lib/types";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { buildFocusBoard, unreadSignalsByCard, focusDetail, replyLine } = interop(focusNs);

const NOW = new Date("2026-10-03T12:00:00.000Z").getTime();
const RECENT = "2026-10-03T11:00:00.000Z";

function card(id: string, status: Status, extra: Partial<Card> = {}): Card {
  return {
    id,
    title: `Card ${id}`,
    status,
    priority: "medium",
    createdAt: RECENT,
    updatedAt: RECENT,
    ...extra,
  } as Card;
}

function event(
  cardId: string,
  type: ActivityType,
  updatedAt: string,
  extra: Partial<ActivityEvent> = {}
): ActivityEvent {
  return {
    id: `${cardId}-${type}-${updatedAt}`,
    type,
    cardId,
    projectId: null,
    title: "",
    summary: null,
    payload: {},
    isRead: false,
    createdAt: updatedAt,
    updatedAt,
    ...extra,
  };
}

const board = (cards: Card[], events: ActivityEvent[]) =>
  buildFocusBoard(cards, undefined, NOW, "development", unreadSignalsByCard(events));

test("an unread chat reply lifts a backlog card out of Waiting", () => {
  const cards = [card("a", "backlog"), card("b", "backlog")];

  const before = buildFocusBoard(cards, undefined, NOW);
  assert.equal(before.yourTurn.length, 0);
  assert.equal(before.waiting.total, 2);

  const after = board(cards, [event("a", "chat-solution", RECENT)]);
  assert.equal(after.yourTurn.length, 1);
  assert.equal(after.yourTurn[0].state, "your-reply");
  assert.equal(after.yourTurn[0].reply?.section, "solution");
  assert.equal(after.waiting.total, 1);
});

test("a card already in Your turn keeps its state and carries the reply", () => {
  const result = board([card("t", "test")], [event("t", "chat-tests", RECENT)]);
  assert.equal(result.yourTurn.length, 1);
  assert.equal(result.yourTurn[0].state, "your-test");
  assert.equal(result.yourTurn[0].reply?.section, "tests");
});

test("read events and apply, plan, sync and team change nothing", () => {
  const cards = [card("a", "backlog"), card("b", "bugs")];
  const result = board(cards, [
    event("a", "chat-detail", RECENT, { isRead: true }),
    event("a", "opinion", RECENT, { isRead: true }),
    event("b", "plan", RECENT),
    event("b", "apply", RECENT),
    event("b", "sync", RECENT),
    event("b", "team", RECENT),
  ]);
  assert.equal(result.yourTurn.length, 0);
  assert.equal(result.waiting.total, 2);
});

test("a fresh opinion lifts its decision above one already read", () => {
  const cards = [
    card("old", "ideation", { aiVerdict: "positive", priority: "high" } as Partial<Card>),
    card("new", "ideation", { aiVerdict: "positive" } as Partial<Card>),
  ];
  const result = board(cards, [
    event("old", "opinion", "2026-09-20T10:00:00.000Z", { isRead: true }),
    event("new", "opinion", "2026-10-03T11:56:00.000Z", {
      payload: { verdict: "positive", verdictRaw: "yes", score: 7 },
    }),
  ]);
  assert.deepEqual(
    result.yourTurn.map((row) => [row.card.id, row.state]),
    [
      ["new", "your-decision"],
      ["old", "your-decision"],
    ]
  );
  const signal = result.yourTurn[0].reply;
  assert.equal(signal?.kind, "opinion");
  assert.equal(signal?.section, "opinion");
  assert.equal(result.yourTurn[1].reply, undefined);
  assert.equal(replyLine(signal!, NOW), "new opinion · Yes (7/10) · 4m ago");
});

test("a failed opinion on an ideation card without a verdict leaves Waiting", () => {
  const result = board(
    [card("a", "ideation")],
    [event("a", "opinion", RECENT, { payload: { failed: true } })]
  );
  assert.equal(result.waiting.total, 0);
  assert.equal(result.yourTurn[0].state, "your-reply");
  assert.equal(result.yourTurn[0].reply?.failed, true);
  assert.equal(
    focusDetail(card("a", "ideation"), NOW, "your-reply", result.yourTurn[0].reply),
    "opinion failed · 1h ago"
  );
});

test("a card dropped from the queue comes back to Your turn on its detail tab", () => {
  const result = board(
    [card("a", "backlog")],
    [event("a", "queue", RECENT, { title: "Dropped from queue", payload: { reason: "no plan" } })]
  );
  assert.equal(result.yourTurn[0].state, "your-reply");
  assert.equal(result.yourTurn[0].reply?.kind, "queue");
  assert.equal(result.yourTurn[0].reply?.section, "detail");
  assert.equal(result.yourTurn[0].reply?.label, "dropped from queue");
});

test("a failed run on a bugs card comes back to Your turn", () => {
  const result = board(
    [card("a", "bugs")],
    [event("a", "quickfix", RECENT, { payload: { failed: true } })]
  );
  assert.equal(result.yourTurn[0].state, "your-reply");
  assert.equal(result.yourTurn[0].reply?.label, "quick fix failed");
  assert.equal(result.yourTurn[0].reply?.section, undefined);
});

test("a finished run on a test card keeps the test row and rides along", () => {
  const result = board(
    [card("t", "test")],
    [event("t", "autonomous", RECENT, { payload: { warning: "no checklist written" } })]
  );
  assert.equal(result.yourTurn[0].state, "your-test");
  assert.equal(result.yourTurn[0].reply?.kind, "run");
  assert.equal(result.yourTurn[0].reply?.warning, true);
  assert.equal(result.yourTurn[0].reply?.label, "run done with a warning");
});

test("replies sort right after blocked", () => {
  const cards = [
    card("review", "progress"),
    card("reply", "bugs"),
    card("blocked", "progress", { rebaseConflict: true } as Partial<Card>),
  ];
  const result = board(cards, [event("reply", "chat-detail", RECENT)]);
  assert.deepEqual(
    result.yourTurn.map((row) => row.state),
    ["blocked", "your-reply", "your-review"]
  );
});

test("a reply on a decision row lifts it to the reply rank but keeps its action", () => {
  const cards = [
    card("review", "progress"),
    card("decision", "ideation", { aiVerdict: "positive" } as Partial<Card>),
    card("blocked", "progress", {
      rebaseConflict: true,
      updatedAt: "2026-10-03T09:00:00.000Z",
    } as Partial<Card>),
  ];
  const result = board(cards, [
    event("decision", "chat-opinion", RECENT),
    event("blocked", "chat-tests", RECENT),
  ]);
  assert.deepEqual(
    result.yourTurn.map((row) => [row.card.id, row.state]),
    [
      ["blocked", "blocked"],
      ["decision", "your-decision"],
      ["review", "your-review"],
    ]
  );
});

test("the newest unread event picks the tab", () => {
  const replies = unreadSignalsByCard([
    event("a", "chat-solution", "2026-10-03T10:00:00.000Z"),
    event("a", "chat-tests", "2026-10-03T11:30:00.000Z"),
    event("a", "chat-opinion", "2026-10-03T09:00:00.000Z"),
  ]);
  assert.equal(replies.get("a")?.section, "tests");
});

test("the newest unread event wins whatever its kind", () => {
  const signals = unreadSignalsByCard([
    event("a", "chat-detail", "2026-10-03T10:00:00.000Z"),
    event("a", "opinion", "2026-10-03T11:30:00.000Z"),
    event("a", "apply", "2026-10-03T11:45:00.000Z"),
    event("b", "opinion", "2026-10-03T10:00:00.000Z"),
    event("b", "chat-solution", "2026-10-03T11:30:00.000Z"),
  ]);
  assert.equal(signals.get("a")?.kind, "opinion");
  assert.equal(signals.get("b")?.kind, "chat");
  assert.equal(signals.get("b")?.section, "solution");
});

test("a failed chat turn still counts, and says so", () => {
  const replies = unreadSignalsByCard([
    event("a", "chat-solution", "2026-10-03T11:48:00.000Z", { payload: { failed: true } }),
  ]);
  const reply = replies.get("a");
  assert.equal(reply?.failed, true);
  assert.equal(
    focusDetail(card("a", "backlog"), NOW, "your-reply", reply),
    "reply failed · Solution · 12m ago"
  );
});

test("a reply alone is enough to make the board not quiet", () => {
  const result = board([card("a", "ideation")], [event("a", "chat-opinion", RECENT)]);
  assert.equal(result.yourTurn.length, 1);
  assert.equal(result.waiting.total, 0);
  assert.equal(result.yourTurn[0].reply?.section, "opinion");
});
