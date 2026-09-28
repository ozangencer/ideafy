import test from "node:test";
import assert from "node:assert/strict";

import * as timeoutNs from "../../lib/autonomous-run/run-timeout";

// See run-output.test.ts: lib/ modules may come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { autonomousRunTimeoutMs } = interop(timeoutNs);
const MIN = 60 * 1000;

test("run timeout: implementation scales with complexity", () => {
  assert.equal(autonomousRunTimeoutMs("implementation", "low"), 10 * MIN);
  assert.equal(autonomousRunTimeoutMs("implementation", "medium"), 20 * MIN);
  assert.equal(autonomousRunTimeoutMs("implementation", "high"), 30 * MIN);
  assert.equal(autonomousRunTimeoutMs("implementation", "very_high"), 45 * MIN);
});

test("run timeout: unknown complexity falls back to medium", () => {
  assert.equal(autonomousRunTimeoutMs("implementation", null), 20 * MIN);
  assert.equal(autonomousRunTimeoutMs("implementation", "huge"), 20 * MIN);
});

test("run timeout: other phases keep the runner default", () => {
  for (const phase of ["planning", "retest", "verify"]) {
    assert.equal(autonomousRunTimeoutMs(phase, "very_high"), undefined);
  }
});
