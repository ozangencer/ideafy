import test from "node:test";
import assert from "node:assert/strict";

import * as cardPhaseNs from "../../lib/card-phase";
import * as typesNs from "../../lib/types";
import * as progressNs from "../../lib/test-progress";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { getPhaseActionFlags, isPhaseActionShown, BOARD_PHASE_ACTIONS } = interop(cardPhaseNs);
const { getColumns } = interop(typesNs);

type Card = Parameters<typeof getPhaseActionFlags>[0];

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "c1",
    title: "Toplantı tutanağı",
    description: "<p>Solvia kick-off notları</p>",
    solutionSummary: "",
    testScenarios: "",
    aiOpinion: "",
    aiVerdict: null,
    status: "backlog",
    complexity: "medium",
    priority: "medium",
    projectFolder: "/tmp/solvia",
    projectId: "p1",
    groupId: null,
    taskNumber: 7,
    gitBranchName: null,
    gitBranchStatus: null,
    gitWorktreePath: null,
    gitWorktreeStatus: null,
    devServerPort: null,
    devServerPid: null,
    rebaseConflict: null,
    conflictFiles: null,
    processingType: null,
    aiPlatform: null,
    useWorktree: null,
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  } as Card;
}

const CHECKLIST = "## Temel akış\n- [ ] Tutanağı aç";

test("work mode: implement has no autonomous run, the terminal stays", () => {
  const card = makeCard({ status: "progress" });
  const flags = getPhaseActionFlags(card, "plan", "", null, "work");
  assert.equal(flags.phase, "implementation");
  assert.equal(flags.canRunAutonomous, false);
  assert.equal(flags.canStart, true);
  assert.equal(isPhaseActionShown("play", flags, false), false);
  assert.equal(isPhaseActionShown("terminal", flags, false), true);
});

test("work mode: quick fix and test together are gone", () => {
  const bug = makeCard({ status: "bugs" });
  assert.equal(getPhaseActionFlags(bug, "", "", null, "work").canQuickFix, false);

  const review = makeCard({ status: "test", testScenarios: CHECKLIST });
  const flags = getPhaseActionFlags(review, "plan", CHECKLIST, null, "work");
  assert.equal(flags.canTestTogether, false);
  assert.equal(isPhaseActionShown("test-together", flags, false), false);
});

test("work mode: planning still runs autonomously", () => {
  const card = makeCard({ status: "backlog" });
  const flags = getPhaseActionFlags(card, "", "", null, "work");
  assert.equal(flags.phase, "planning");
  assert.equal(flags.canRunAutonomous, true);
});

test("work mode: dev controls hide, unless an old worktree is still open", () => {
  const plain = makeCard({ status: "test" });
  assert.equal(getPhaseActionFlags(plain, "", "", null, "work").showDevControls, false);

  const withWorktree = makeCard({ status: "test", gitWorktreeStatus: "active" });
  assert.equal(getPhaseActionFlags(withWorktree, "", "", null, "work").showDevControls, true);
});

test("development mode behaves as before, with or without the argument", () => {
  const bug = makeCard({ status: "bugs" });
  assert.equal(getPhaseActionFlags(bug, "", "", null).canQuickFix, true);
  assert.equal(getPhaseActionFlags(bug, "", "", null, "development").canQuickFix, true);

  const progress = makeCard({ status: "progress" });
  const flags = getPhaseActionFlags(progress, "plan", "", null, "development");
  assert.equal(flags.canRunAutonomous, true);
  assert.equal(flags.showDevControls, true);

  const review = makeCard({ status: "test", testScenarios: CHECKLIST });
  assert.equal(getPhaseActionFlags(review, "plan", CHECKLIST, null).canTestTogether, true);
});

test("generate is declared but never shown yet", () => {
  for (const mode of ["development", "work"] as const) {
    const flags = getPhaseActionFlags(makeCard({ status: "backlog" }), "", "", null, mode);
    assert.equal(flags.canGenerate, false);
    assert.equal(isPhaseActionShown("generate", flags, false), false);
  }
  assert.equal(BOARD_PHASE_ACTIONS.includes("generate"), false);
});

test("column labels: ids and order are shared, only dev titles change", () => {
  const dev = getColumns("development");
  const work = getColumns("work");
  assert.deepEqual(
    work.map((c) => c.id),
    dev.map((c) => c.id)
  );
  const title = (cols: typeof dev, id: string) => cols.find((c) => c.id === id)?.title;
  assert.equal(title(work, "test"), "In Review");
  assert.equal(title(work, "bugs"), "Revisions");
  assert.equal(title(work, "completed"), "Done");
  assert.equal(title(work, "progress"), "In Progress");
  assert.equal(title(dev, "test"), "Human Test");
});

test("Pre-verify is offered while any group from the core flow on has an unticked item", () => {
  const { canPreVerify } = interop(cardPhaseNs);
  const { parseTestProgress } = interop(progressNs);
  const item = (checked: boolean) => `<li data-type="taskItem" data-checked="${checked}"><p>x</p></li>`;
  const checklist = (core: boolean[], edge: boolean[], heading = "Core flow") =>
    parseTestProgress(`<h2>${heading}</h2><ul>${core.map(item).join("")}</ul><h2>Edge cases</h2><ul>${edge.map(item).join("")}</ul>`);
  const card = makeCard({ status: "test" });
  assert.equal(canPreVerify(card, checklist([true, false], [false])), true);
  // The core flow is ticked, but Edge cases is still open: the button stays.
  assert.equal(canPreVerify(card, checklist([true, true], [false])), true);
  assert.equal(canPreVerify(card, checklist([true, true], [true])), false);
  // Without a core heading the agent cannot tell what is essential.
  assert.equal(canPreVerify(card, checklist([false], [false], "Steps")), false);
});

test("Pre-verify's label names the group past the core flow", () => {
  const { getPhaseActionFlags } = interop(cardPhaseNs);
  const { parseTestProgress } = interop(progressNs);
  const html =
    '<h2>Temel akış</h2><ul><li data-type="taskItem" data-checked="true"><p>x</p></li></ul>' +
    '<h2>Kenar durumlar</h2><ul><li data-type="taskItem" data-checked="false"><p>y</p></li></ul>';
  const card = makeCard({ status: "test", testScenarios: html });
  const flags = getPhaseActionFlags(card, "plan", "x y", parseTestProgress(html));
  // The checklist is Turkish, the button is not: the contract's groups read in English.
  assert.equal(flags.labels.play, "Pre-verify: Edge cases (Autonomous)");
  assert.equal(flags.canRunAutonomous, true);
});
