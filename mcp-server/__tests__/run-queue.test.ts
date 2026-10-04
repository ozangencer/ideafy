import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import * as cardQueueNs from "../../lib/card-queue";
import * as runErrorNs from "../../lib/run-error";
import * as planFilesNs from "../../lib/plan-files";
import * as workspaceNs from "../../lib/workspace";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { queueIneligibleReason, queueRanks, QUEUE_CLEARING_STATUSES, sharedWorkingCopyWith, conflictingLiveRun } =
  interop(cardQueueNs);
const { infrastructureRunError, isInfrastructureRunError } = interop(runErrorNs);
const { sharedPlanFiles } = interop(planFilesNs);
const { shouldUseWorktree, worktreeOverrideFor } = interop(workspaceNs);

const eligible = {
  status: "backlog",
  hasDescription: true,
  phase: "implementation",
  processingType: null,
  projectMode: "development",
  hasCoreFlow: false,
  gitBranchStatus: null,
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
  // Human Test is the one way back in, for pre-verify; its rules are below.
  for (const status of QUEUE_CLEARING_STATUSES) {
    if (status === "test") continue;
    assert.ok(queueIneligibleReason({ ...eligible, status }), status);
  }
});

const verifiable = {
  ...eligible,
  status: "test",
  phase: "verify",
  hasCoreFlow: true,
  gitBranchStatus: "active",
};

test("run queue: a Human Test card with a core flow can be queued for pre-verify", () => {
  assert.equal(queueIneligibleReason(verifiable), null);
  // Merged: the code is on main now, and that is where the run goes.
  assert.equal(queueIneligibleReason({ ...verifiable, gitBranchStatus: "merged" }), null);
  assert.equal(queueIneligibleReason({ ...verifiable, gitBranchStatus: null }), null);
});

test("run queue: pre-verify is refused where the board's button would not run", () => {
  assert.match(queueIneligibleReason({ ...verifiable, hasCoreFlow: false })!, /core-flow/);
  assert.match(queueIneligibleReason({ ...verifiable, projectMode: "work" })!, /Work/);
  assert.match(queueIneligibleReason({ ...verifiable, gitBranchStatus: "rolled_back" })!, /rolled back/);
  assert.match(queueIneligibleReason({ ...verifiable, processingType: "autonomous" })!, /already/);
  assert.match(queueIneligibleReason({ ...verifiable, hasDescription: false })!, /description/);
  assert.ok(queueIneligibleReason({ ...verifiable, phase: "implementation" }));
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

const run = (
  id: string,
  runsInWorktree: boolean,
  projectId: string | null = "p1",
  kind: "implementation" | "verify" = "implementation"
) => ({
  id,
  projectId,
  runsInWorktree,
  kind,
});

test("run queue: a worktree-less card is warned about the worktree-less run ahead of it", () => {
  const ahead = [run("a", false), run("b", true), run("c", false)];
  // The closest one: its uncommitted diff is the one this card starts on.
  assert.equal(sharedWorkingCopyWith(run("self", false), ahead)?.id, "c");
});

test("run queue: no warning when nothing ahead shares the working copy", () => {
  assert.equal(sharedWorkingCopyWith(run("self", false), [run("a", true), run("b", true)]), null);
  assert.equal(sharedWorkingCopyWith(run("self", false), [run("a", false, "p2")]), null);
  assert.equal(sharedWorkingCopyWith(run("self", true), [run("a", false)]), null);
  assert.equal(sharedWorkingCopyWith(run("self", false), [run("self", false)]), null);
});

test("run queue: a pre-verify ahead leaves no diff to share", () => {
  assert.equal(sharedWorkingCopyWith(run("self", false), [run("a", false, "p1", "verify")]), null);
  // It does not hide the implementation run behind it either.
  const ahead = [run("a", false), run("b", false, "p1", "verify")];
  assert.equal(sharedWorkingCopyWith(run("self", false), ahead)?.id, "a");
  // A pre-verify without a worktree is warned about the implementation ahead of it.
  assert.equal(sharedWorkingCopyWith(run("self", false, "p1", "verify"), [run("a", false)])?.id, "a");
});

type LiveKind = "planning" | "implementation" | "retest" | "verify" | "quick-fix" | "tests-chat";
const live = (id: string, runsInWorktree: boolean, kind: LiveKind = "implementation", projectId: string | null = "p1") => ({
  id,
  projectId,
  runsInWorktree,
  kind,
});

test("run conflict: two runs on main in one project collide", () => {
  assert.equal(conflictingLiveRun(live("self", false), [live("a", false)])?.id, "a");
  // A pre-verify on main breaks just as surely with a run writing next to it.
  assert.equal(conflictingLiveRun(live("self", false, "verify"), [live("a", false)])?.id, "a");
  assert.equal(conflictingLiveRun(live("self", false), [live("a", false, "quick-fix")])?.id, "a");
  assert.equal(conflictingLiveRun(live("self", false, "quick-fix"), [live("a", false, "retest")])?.id, "a");
});

test("run conflict: a Tests chat answering on main counts as a run", () => {
  assert.equal(conflictingLiveRun(live("self", false), [live("a", false, "tests-chat")])?.id, "a");
  assert.equal(conflictingLiveRun(live("self", false, "quick-fix"), [live("a", false, "tests-chat")])?.id, "a");
  assert.equal(conflictingLiveRun(live("self", false, "verify"), [live("a", false, "tests-chat")])?.id, "a");
  // A run in its own worktree still goes ahead next to it, and a chat in its
  // card's worktree leaves main alone.
  assert.equal(conflictingLiveRun(live("self", true), [live("a", false, "tests-chat")]), null);
  assert.equal(conflictingLiveRun(live("self", false), [live("a", true, "tests-chat")]), null);
});

test("run conflict: a worktree on either side keeps them apart", () => {
  assert.equal(conflictingLiveRun(live("self", true), [live("a", false)]), null);
  assert.equal(conflictingLiveRun(live("self", false), [live("a", true)]), null);
  assert.equal(conflictingLiveRun(live("self", false), [live("a", true), live("b", false)])?.id, "b");
});

test("run conflict: other projects, planning and the card itself do not count", () => {
  assert.equal(conflictingLiveRun(live("self", false), [live("a", false, "implementation", "p2")]), null);
  assert.equal(conflictingLiveRun(live("self", false, "planning"), [live("a", false)]), null);
  assert.equal(conflictingLiveRun(live("self", false), [live("a", false, "planning")]), null);
  assert.equal(conflictingLiveRun(live("self", false), [live("self", false)]), null);
});

test("run queue: a card's branch follows card override, then project, then worktree", () => {
  const dev = { useWorktrees: true, mode: "development" };
  assert.equal(shouldUseWorktree({ useWorktree: null }, dev), true);
  assert.equal(shouldUseWorktree({ useWorktree: false }, dev), false);
  assert.equal(shouldUseWorktree({ useWorktree: null }, { ...dev, useWorktrees: false }), false);
  assert.equal(shouldUseWorktree({ useWorktree: true }, { ...dev, useWorktrees: false }), true);
  assert.equal(shouldUseWorktree({ useWorktree: null }, null), true);
  assert.equal(shouldUseWorktree({ useWorktree: true }, { ...dev, mode: "work" }), false);
});

test("run queue: picking the project default stores no override", () => {
  assert.equal(worktreeOverrideFor(true, true), null);
  assert.equal(worktreeOverrideFor(false, false), null);
  assert.equal(worktreeOverrideFor(false, true), false);
  assert.equal(worktreeOverrideFor(true, false), true);
});

// The trigger lives only in SQL, so it is checked against the migrations
// themselves, applied in order to a bare cards table.
function queueTriggerDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY, status TEXT NOT NULL)");
  for (const tag of ["0017_card_queue_position", "0018_queue_reset_on_status_change"]) {
    const sql = readFileSync(new URL(`../../drizzle/${tag}.sql`, import.meta.url), "utf-8");
    for (const statement of sql.split("--> statement-breakpoint")) db.exec(statement);
  }
  return db;
}

function queuePositionAfter(db: DatabaseSync, from: string, to: string): unknown {
  db.prepare("INSERT INTO cards (id, status, queue_position) VALUES ('c', ?, 1)").run(from);
  db.prepare("UPDATE cards SET status = ? WHERE id = 'c'").run(to);
  return (db.prepare("SELECT queue_position FROM cards WHERE id = 'c'").get() as { queue_position: unknown })
    .queue_position;
}

test("queue trigger: moving into Human Test still clears the position", () => {
  assert.equal(queuePositionAfter(queueTriggerDb(), "backlog", "test"), null);
  assert.equal(queuePositionAfter(queueTriggerDb(), "progress", "completed"), null);
});

test("queue trigger: re-saving a Human Test card's status keeps it queued", () => {
  assert.equal(queuePositionAfter(queueTriggerDb(), "test", "test"), 1);
  assert.equal(queuePositionAfter(queueTriggerDb(), "test", "bugs"), 1);
});
