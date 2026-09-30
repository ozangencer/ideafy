import test from "node:test";
import assert from "node:assert/strict";

import * as cardQueueNs from "../../lib/card-queue";
import * as runErrorNs from "../../lib/run-error";
import * as planFilesNs from "../../lib/plan-files";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { queueIneligibleReason, queueRanks, QUEUE_CLEARING_STATUSES } = interop(cardQueueNs);
const { infrastructureRunError, isInfrastructureRunError } = interop(runErrorNs);
const { sharedPlanFiles } = interop(planFilesNs);

const eligible = {
  status: "backlog",
  hasDescription: true,
  phase: "implementation",
  processingType: null,
  projectMode: "development",
};

test("run queue: a planned card with no checklist can be queued", () => {
  assert.equal(queueIneligibleReason(eligible), null);
  assert.equal(queueIneligibleReason({ ...eligible, status: "progress" }), null);
});

test("run queue: only implementation runs are queued", () => {
  assert.match(queueIneligibleReason({ ...eligible, phase: "planning" })!, /no plan/);
  assert.match(queueIneligibleReason({ ...eligible, phase: "retest" })!, /checklist/);
  assert.match(queueIneligibleReason({ ...eligible, projectMode: "work" })!, /Work/);
  assert.match(queueIneligibleReason({ ...eligible, processingType: "autonomous" })!, /already/);
  assert.match(queueIneligibleReason({ ...eligible, hasDescription: false })!, /description/);
});

test("run queue: statuses the DB trigger clears are refused up front", () => {
  for (const status of QUEUE_CLEARING_STATUSES) {
    assert.ok(queueIneligibleReason({ ...eligible, status }), status);
  }
});

test("run queue: ranks follow position and skip the gaps the trigger leaves", () => {
  const ranks = queueRanks([
    { id: "a", queuePosition: 4, taskNumber: 1 },
    { id: "b", queuePosition: null, taskNumber: 2 },
    { id: "c", queuePosition: 1, taskNumber: 3 },
  ]);
  assert.deepEqual([...ranks.entries()], [["c", 1], ["a", 2]]);
});

test("run error: machine-level failures pause the queue", () => {
  assert.equal(infrastructureRunError("Claude AI usage limit reached|1790630000"), "usage limit reached");
  assert.equal(infrastructureRunError("Invalid API key · Please run /login"), "CLI is not logged in");
  assert.equal(infrastructureRunError("spawn claude ENOENT"), "CLI not found");
  assert.equal(infrastructureRunError("Working directory not found: /tmp/x"), "project folder not found");
  assert.equal(infrastructureRunError("Claude Code timed out after 20 minutes"), "run timed out");
  assert.equal(infrastructureRunError("Failed to create git worktree: fatal"), "worktree could not be created");
});

test("run error: a card-level failure does not", () => {
  assert.equal(isInfrastructureRunError("Claude Code exited with code 1: TypeError in lib/foo.ts"), false);
  assert.equal(isInfrastructureRunError(null), false);
});

test("plan files: shared files match exactly or under a glob", () => {
  assert.deepEqual(
    sharedPlanFiles(["lib/types.ts", "./lib/db/schema.ts", "app/a.ts"], ["lib/types.ts", "lib/db/*"]),
    ["lib/types.ts", "lib/db/schema.ts"]
  );
  assert.deepEqual(sharedPlanFiles(["a.ts"], ["b.ts"]), []);
});
