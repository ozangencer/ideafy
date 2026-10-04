import test from "node:test";
import assert from "node:assert/strict";

import * as labelsNs from "../../lib/process-labels";
import * as typesNs from "../../lib/types";

// See run-output.test.ts: lib/ modules may come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const {
  autonomousRunTitle,
  phaseLabel,
  processRowLabel,
  processBaseLabel,
  processShortLabel,
  processTimeHint,
  formatElapsedShort,
} = interop(labelsNs);
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

type Row = Parameters<typeof processRowLabel>[0];

function row(overrides: Partial<Row>): Row {
  return {
    processType: "autonomous",
    sectionType: null,
    status: "running",
    endReason: undefined,
    warning: null,
    phase: null,
    targetColumn: null,
    ...overrides,
  };
}

test("popover row: a running run names its phase and where it moves the card", () => {
  assert.equal(processRowLabel(row({ phase: "planning", targetColumn: "In Progress" })), "Plan → In Progress");
  assert.equal(processRowLabel(row({ phase: "implementation", targetColumn: "Human Test" })), "Implementation → Human Test");
  assert.equal(processRowLabel(row({ phase: "retest", targetColumn: null })), "Fix & retest");
  assert.equal(processRowLabel(row({ phase: "verify" })), "Pre-verify");
});

test("popover row: a finished run reads like the bell", () => {
  const done = { status: "completed" as const, endReason: "completed" as const };
  assert.equal(
    processRowLabel(row({ ...done, phase: "implementation", targetColumn: "Human Test" })),
    "Implementation completed → Human Test"
  );
  assert.equal(
    processRowLabel(row({ ...done, phase: "verify", warning: "Checklist left untouched" })),
    "Pre-verify finished with a warning"
  );
  assert.equal(
    processRowLabel(row({ status: "completed", endReason: "failed", phase: "implementation", targetColumn: "Human Test" })),
    "Implementation failed"
  );
  assert.equal(
    processRowLabel(row({ status: "completed", endReason: "aborted", phase: "implementation" })),
    "Implementation · Interrupted on reload"
  );
});

test("popover row: no phase falls back to the generic label", () => {
  assert.equal(processRowLabel(row({})), "Autonomous task");
  assert.equal(processRowLabel(row({ status: "completed", endReason: "completed" })), "Autonomous task completed");
  assert.equal(processRowLabel(row({ processType: "chat", sectionType: "tests" })), "Chat (Tests)");
  assert.equal(processRowLabel(row({ processType: "evaluate" })), "AI Opinion");
  assert.equal(processRowLabel(row({ processType: "quick-fix", status: "completed", endReason: "failed" })), "Quick Fix failed");
  assert.equal(processBaseLabel(row({ phase: "verify", targetColumn: "Human Test" })), "Pre-verify");
});

test("popover row: elapsed while running, ago once finished", () => {
  const start = "2026-10-04T12:00:00.000Z";
  const now = Date.parse("2026-10-04T12:03:12.000Z");
  assert.equal(processTimeHint({ status: "running", startedAt: start }, now), "3m 12s");
  assert.equal(processTimeHint({ status: "completed", startedAt: start, completedAt: "2026-10-04T11:59:00.000Z" }, now), "4m ago");
  assert.equal(processTimeHint({ status: "completed", startedAt: start, completedAt: "2026-10-04T12:03:00.000Z" }, now), "just now");
  assert.equal(processTimeHint({ status: "completed", startedAt: start }, now), null);
});

test("focus line: a running run reads its phase, target column and minutes", () => {
  assert.equal(processRowLabel(row({ phase: "implementation", targetColumn: "Human Test" })), "Implementation → Human Test");
  assert.equal(processRowLabel(row({ processType: "quick-fix" })), "Quick Fix");
  assert.equal(formatElapsedShort(14 * 60000 + 59000), "14m");
  assert.equal(formatElapsedShort(30000), "0m");
  assert.equal(formatElapsedShort(65 * 60000), "1h 05m");
  assert.equal(formatElapsedShort(-5000), "0m");
});

test("focus line: three or more runs fall back to the short phase", () => {
  assert.equal(processShortLabel(row({ phase: "implementation", targetColumn: "Human Test" })), "impl");
  assert.equal(processShortLabel(row({ phase: "verify" })), "verify");
  assert.equal(processShortLabel(row({ phase: "planning" })), "plan");
  assert.equal(processShortLabel(row({ phase: "retest" })), "retest");
  assert.equal(processShortLabel(row({ processType: "evaluate" })), "AI Opinion");
  assert.equal(processShortLabel(row({ phase: "generate" })), "Autonomous task");
});
