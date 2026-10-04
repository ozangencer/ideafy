import test from "node:test";
import assert from "node:assert/strict";

import * as timeoutNs from "../../lib/autonomous-run/run-timeout";

// See run-output.test.ts: lib/ modules may come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const {
  autonomousRunLimits,
  runIdleTimeoutMs,
  shouldKillForIdle,
  formatRunDuration,
  DEFAULT_RUN_IDLE_TIMEOUT_MS,
} = interop(timeoutNs);
const MIN = 60 * 1000;

test("run limits: implementation hard limit scales with complexity", () => {
  assert.equal(autonomousRunLimits("implementation", "trivial").hardMs, 20 * MIN);
  assert.equal(autonomousRunLimits("implementation", "low").hardMs, 20 * MIN);
  assert.equal(autonomousRunLimits("implementation", "medium").hardMs, 40 * MIN);
  assert.equal(autonomousRunLimits("implementation", "high").hardMs, 60 * MIN);
  assert.equal(autonomousRunLimits("implementation", "very_high").hardMs, 90 * MIN);
});

test("run limits: a pre-verify of all remaining groups grows with its items, up to 90 minutes", () => {
  assert.equal(autonomousRunLimits("verify", "high").hardMs, 30 * MIN);
  assert.equal(autonomousRunLimits("verify", "high", 5).hardMs, 45 * MIN);
  assert.equal(autonomousRunLimits("verify", "high", 40).hardMs, 90 * MIN);
  // Only verify grows this way.
  assert.equal(autonomousRunLimits("planning", null, 5).hardMs, 30 * MIN);
});

test("run limits: unknown complexity falls back to medium", () => {
  assert.equal(autonomousRunLimits("implementation", null).hardMs, 40 * MIN);
  assert.equal(autonomousRunLimits("implementation", "huge").hardMs, 40 * MIN);
});

test("run limits: other phases get their own ceiling, not the runner's 10 minutes", () => {
  for (const phase of ["planning", "retest", "verify"]) {
    assert.equal(autonomousRunLimits(phase, "very_high").hardMs, 30 * MIN);
    assert.equal(autonomousRunLimits(phase, "low").hardMs, 30 * MIN);
  }
});

test("run limits: every phase carries the idle limit, below its hard limit", () => {
  for (const phase of ["planning", "implementation", "retest", "verify"]) {
    const limits = autonomousRunLimits(phase, "trivial");
    assert.equal(limits.idleMs, DEFAULT_RUN_IDLE_TIMEOUT_MS);
    assert.ok(limits.idleMs < limits.hardMs);
  }
});

test("run limits: idle limit stays above the 240s bash timeout", () => {
  assert.ok(DEFAULT_RUN_IDLE_TIMEOUT_MS > 240_000);
});

test("run limits: IDEAFY_RUN_IDLE_TIMEOUT_MS overrides the idle limit", () => {
  const previous = process.env.IDEAFY_RUN_IDLE_TIMEOUT_MS;
  try {
    process.env.IDEAFY_RUN_IDLE_TIMEOUT_MS = "30000";
    assert.equal(runIdleTimeoutMs(), 30_000);
    process.env.IDEAFY_RUN_IDLE_TIMEOUT_MS = "not-a-number";
    assert.equal(runIdleTimeoutMs(), DEFAULT_RUN_IDLE_TIMEOUT_MS);
    process.env.IDEAFY_RUN_IDLE_TIMEOUT_MS = "0";
    assert.equal(runIdleTimeoutMs(), DEFAULT_RUN_IDLE_TIMEOUT_MS);
  } finally {
    if (previous === undefined) delete process.env.IDEAFY_RUN_IDLE_TIMEOUT_MS;
    else process.env.IDEAFY_RUN_IDLE_TIMEOUT_MS = previous;
  }
});

test("idle check: kills only once the silence reaches the limit", () => {
  const start = 1_000_000;
  assert.equal(shouldKillForIdle(start + 8 * MIN - 1, start, 8 * MIN), false);
  assert.equal(shouldKillForIdle(start + 8 * MIN, start, 8 * MIN), true);
  assert.equal(shouldKillForIdle(start + 20 * MIN, start, 8 * MIN), true);
});

test("idle check: fresh output resets the clock", () => {
  const start = 1_000_000;
  const lastOutput = start + 7 * MIN;
  assert.equal(shouldKillForIdle(start + 9 * MIN, lastOutput, 8 * MIN), false);
});

test("duration format: minutes, singular, and sub-minute overrides", () => {
  assert.equal(formatRunDuration(10 * MIN), "10 minutes");
  assert.equal(formatRunDuration(MIN), "1 minute");
  assert.equal(formatRunDuration(30_000), "30 seconds");
});
