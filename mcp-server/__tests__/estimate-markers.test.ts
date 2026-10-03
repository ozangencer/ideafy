import test from "node:test";
import assert from "node:assert/strict";

import * as markersNs from "../../lib/mentions/estimate-markers";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { findEstimateMarkers } = interop(markersNs);

// IDE-374: the `[COMPLEXITY: …]` / `[PRIORITY: …]` lines at the end of a plan
// or opinion render as chips. Only markers carrying a real value qualify.

test("matches every complexity and priority value", () => {
  for (const value of ["trivial", "low", "medium", "high", "very_high"]) {
    const [m] = findEstimateMarkers(`[COMPLEXITY: ${value}]`);
    assert.equal(m?.kind, "complexity");
    assert.equal(m?.value, value);
  }
  for (const value of ["low", "medium", "high"]) {
    const [m] = findEstimateMarkers(`[PRIORITY: ${value}]`);
    assert.equal(m?.kind, "priority");
    assert.equal(m?.value, value);
  }
});

test("ignores case and normalises the value", () => {
  const [m] = findEstimateMarkers("[complexity:MEDIUM]");
  assert.equal(m.kind, "complexity");
  assert.equal(m.value, "medium");
});

test("returns the offsets of the marker and of its value", () => {
  const text = "Plan done.\n[COMPLEXITY: low]\n[PRIORITY: high]";
  const found = findEstimateMarkers(text);
  assert.deepEqual(
    found.map((m) => [text.slice(m.from, m.to), text.slice(m.valueFrom, m.valueTo)]),
    [
      ["[COMPLEXITY: low]", "low"],
      ["[PRIORITY: high]", "high"],
    ],
  );
});

test("does not match the prompt template's literal value list", () => {
  assert.deepEqual(findEstimateMarkers("[COMPLEXITY: trivial/low/medium/high/very_high]"), []);
  assert.deepEqual(findEstimateMarkers("[PRIORITY: low/medium/high]"), []);
});

test("covers only the bracketed part of an opinion line", () => {
  const text = "[PRIORITY: high] — blocks the release";
  const [m] = findEstimateMarkers(text);
  assert.equal(m.from, 0);
  assert.equal(text.slice(m.from, m.to), "[PRIORITY: high]");
});

test("skips unrelated markers and out-of-range priorities", () => {
  assert.deepEqual(findEstimateMarkers("[STATUS: high]"), []);
  assert.deepEqual(findEstimateMarkers("[PRIORITY: very_high]"), []);
  assert.deepEqual(findEstimateMarkers("no markers here"), []);
});

// IDE-403: an opinion's [VERDICT: …] and [SCORE: X/10] render as chips too.
// The verdict is coloured by its word; the score stays neutral (no level).
test("matches verdict words and scores", () => {
  for (const value of ["strong_yes", "yes", "maybe", "no", "strong_no"]) {
    const [m] = findEstimateMarkers(`[VERDICT: ${value}]`);
    assert.equal(m?.kind, "verdict");
    assert.equal(m?.level, value);
  }
  const [score] = findEstimateMarkers("[SCORE: 7/10] — solid");
  assert.equal(score.kind, "score");
  assert.equal(score.value, "7/10");
  assert.equal(score.level, null);
});

test("does not match the verdict and score template literals or out-of-range scores", () => {
  assert.deepEqual(findEstimateMarkers("[VERDICT: strong_yes/yes/maybe/no/strong_no]"), []);
  assert.deepEqual(findEstimateMarkers("[SCORE: X/10]"), []);
  assert.deepEqual(findEstimateMarkers("[SCORE: 11/10]"), []);
  assert.deepEqual(findEstimateMarkers("[VERDICT: perhaps]"), []);
});
