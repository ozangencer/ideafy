import test from "node:test";
import assert from "node:assert/strict";

import * as dirtyNs from "../../lib/card-dirty-fields";
import type { Card } from "../../lib/types";
import type { CardFormValues } from "../../lib/card-dirty-fields";

// See run-output.test.ts: lib/ modules may come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { buildDirtyCardPayload } = interop(dirtyNs);

const card = {
  id: "c1",
  title: "Warp Terminalde her seferinde yeni pencere açılması",
  description: "<p>desc</p>",
  solutionSummary: "<p>plan</p>",
  testScenarios: "<ul><li>check</li></ul>",
  aiOpinion: "",
  status: "test",
  complexity: null,
  priority: "high",
  projectId: "p1",
  projectFolder: "/work/ideafy",
  groupId: null,
  aiPlatform: null,
} as unknown as Card;

function formOf(c: Card): CardFormValues {
  return {
    title: c.title,
    description: c.description,
    solutionSummary: c.solutionSummary,
    testScenarios: c.testScenarios,
    aiOpinion: c.aiOpinion,
    status: c.status,
    complexity: c.complexity || "medium",
    priority: c.priority || "medium",
    projectId: c.projectId,
    groupId: c.groupId ?? null,
    aiPlatform: c.aiPlatform ?? null,
  };
}

const folders: Record<string, string> = { p1: "/work/ideafy", p2: "/work/cloud" };
const folderFor = (id: string | null) => (id ? folders[id] : undefined);

test("dirty fields: an untouched form sends nothing", () => {
  assert.deepEqual(buildDirtyCardPayload(formOf(card), card, folderFor), {});
});

test("dirty fields: a checklist edit leaves the status out", () => {
  const form = { ...formOf(card), testScenarios: "<ul><li>edited</li></ul>" };
  const payload = buildDirtyCardPayload(form, card, folderFor);
  assert.deepEqual(payload, { testScenarios: "<ul><li>edited</li></ul>" });
  assert.equal("status" in payload, false);
});

test("dirty fields: a null complexity matches the form's medium default", () => {
  const payload = buildDirtyCardPayload({ ...formOf(card), complexity: "medium" }, card, folderFor);
  assert.equal("complexity" in payload, false);
});

test("dirty fields: a project change carries its folder and group", () => {
  const payload = buildDirtyCardPayload({ ...formOf(card), projectId: "p2" }, card, folderFor);
  assert.deepEqual(payload, { projectId: "p2", projectFolder: "/work/cloud", groupId: null });
});

test("dirty fields: a project with no known folder keeps the card's", () => {
  const payload = buildDirtyCardPayload({ ...formOf(card), projectId: "p9" }, card, folderFor);
  assert.deepEqual(payload, { projectId: "p9", projectFolder: "/work/ideafy", groupId: null });
});

// The group was picked and auto-saved, but the card the form compares
// against still says null — a project change that clears the group must
// still send groupId: null, or the server keeps the card in the old
// project's group and refuses the move.
test("dirty fields: a project change sends a cleared group even when the card looks ungrouped", () => {
  const form = { ...formOf(card), projectId: "p2", groupId: null };
  const payload = buildDirtyCardPayload(form, card, folderFor);
  assert.equal("groupId" in payload, true);
  assert.equal(payload.groupId, null);
});
