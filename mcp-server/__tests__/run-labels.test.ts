import test from "node:test";
import assert from "node:assert/strict";

import * as labelsNs from "../../lib/process-labels";
import * as typesNs from "../../lib/types";

// See run-output.test.ts: lib/ modules may come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { autonomousRunTitle, phaseLabel } = interop(labelsNs);
const { getColumnTitle } = interop(typesNs);

test("run title: each phase reads its own completion", () => {
  assert.equal(autonomousRunTitle("planning", "completed", "In Progress"), "Plan ready → In Progress");
  assert.equal(autonomousRunTitle("implementation", "completed", "Human Test"), "Implementation completed → Human Test");
  assert.equal(autonomousRunTitle("retest", "completed", null), "Fix & retest completed");
  assert.equal(autonomousRunTitle("verify", "completed", null), "Pre-verify completed");
});

test("run title: a warning keeps the phase and the move", () => {
  assert.equal(autonomousRunTitle("planning", "warning", "In Progress"), "Plan finished with a warning → In Progress");
  assert.equal(autonomousRunTitle("implementation", "warning", "Human Test"), "Implementation finished with a warning → Human Test");
  assert.equal(autonomousRunTitle("retest", "warning", null), "Fix & retest finished with a warning");
  assert.equal(autonomousRunTitle("verify", "warning", null), "Pre-verify finished with a warning");
});

test("run title: a failure names the phase and never an arrow", () => {
  assert.equal(autonomousRunTitle("planning", "failed", "In Progress"), "Plan failed");
  assert.equal(autonomousRunTitle("implementation", "failed", null), "Implementation failed");
  assert.equal(autonomousRunTitle("retest", "failed", null), "Fix & retest failed");
  assert.equal(autonomousRunTitle("verify", "failed", null), "Pre-verify failed");
});

test("run title: Work mode names its own review column", () => {
  const column = getColumnTitle("test", "work");
  assert.equal(autonomousRunTitle("implementation", "completed", column), "Implementation completed → In Review");
});

test("run title: no target column, no arrow", () => {
  assert.equal(autonomousRunTitle("planning", "completed", null), "Plan ready");
  assert.equal(autonomousRunTitle("implementation", "completed", undefined), "Implementation completed");
});

test("run title: no phase falls back to the caller's label", () => {
  assert.equal(autonomousRunTitle(null, "completed", "Human Test"), null);
  assert.equal(autonomousRunTitle(undefined, "failed", null), null);
  assert.equal(autonomousRunTitle("generate", "completed", null), null);
  assert.equal(phaseLabel(undefined), null);
  assert.equal(phaseLabel("verify"), "Pre-verify");
});
