import test from "node:test";
import assert from "node:assert/strict";

import * as initialTabNs from "../../lib/card-initial-tab";
import type { Card } from "../../lib/types";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { getInitialTabForCard } = interop(initialTabNs);

function card(extra: Partial<Card>): Card {
  return {
    id: "c1",
    title: "Card",
    description: "<p>What to build</p>",
    solutionSummary: "",
    testScenarios: "",
    aiOpinion: "",
    status: "backlog",
    ...extra,
  } as Card;
}

const PLAN = "<h1>Plan</h1><p>Steps</p>";
const OPINION = "<h2>Summary Verdict</h2><p>[VERDICT: yes]</p>";

test("a planned Backlog card opens on its plan, not the older opinion", () => {
  const c = card({ solutionSummary: PLAN, aiOpinion: OPINION });
  assert.equal(getInitialTabForCard(c), "solution");
});

test("an evaluated, unplanned Backlog card opens on the opinion", () => {
  assert.equal(getInitialTabForCard(card({ aiOpinion: OPINION })), "opinion");
});

test("a Backlog card with neither plan nor opinion opens on Detail", () => {
  assert.equal(getInitialTabForCard(card({})), "detail");
});

test("an Ideation card opens on its opinion once evaluated, Detail before", () => {
  assert.equal(getInitialTabForCard(card({ status: "ideation", aiOpinion: OPINION })), "opinion");
  assert.equal(getInitialTabForCard(card({ status: "ideation" })), "detail");
});

test("a Bugs card stays on Detail even with an opinion", () => {
  const c = card({ status: "bugs", aiOpinion: OPINION, solutionSummary: PLAN });
  assert.equal(getInitialTabForCard(c), "detail");
});

test("a Human Test card opens on Tests even before the checklist exists", () => {
  assert.equal(getInitialTabForCard(card({ status: "test", aiOpinion: OPINION })), "tests");
});

test("an In Progress card without a plan falls back to Detail", () => {
  assert.equal(getInitialTabForCard(card({ status: "progress", aiOpinion: OPINION })), "detail");
  assert.equal(getInitialTabForCard(card({ status: "progress", solutionSummary: PLAN })), "solution");
});

test("an opinion that is only an empty paragraph counts as empty", () => {
  assert.equal(getInitialTabForCard(card({ aiOpinion: "<p></p>" })), "detail");
});
