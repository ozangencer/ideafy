import test from "node:test";
import assert from "node:assert/strict";

import * as progressNs from "../../lib/test-progress";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { parseTestProgress, nextVerifyGroup, verifyTargets, canVerifyAllGroups, describeTestGroup, testGroupLabel, untickedIn } =
  interop(progressNs);

const item = (checked: boolean, text = "adım") =>
  `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"><span></span></label><div><p>${text}</p></div></li>`;
const group = (heading: string, ...items: boolean[]) =>
  `<h2>${heading}</h2><ul data-type="taskList">${items.map((c) => item(c)).join("")}</ul>`;

test("groups keep their heading as written, in checklist order", () => {
  const html = group("Temel akış", true, false) + group("Kenar durumlar", false) + group("Regresyon", false, false);
  const progress = parseTestProgress(html)!;
  assert.deepEqual(
    progress.groups.map((g) => [g.heading, g.core, g.checked, g.total]),
    [
      ["Temel akış", true, 1, 2],
      ["Kenar durumlar", false, 0, 1],
      ["Regresyon", false, 0, 2],
    ]
  );
  assert.deepEqual(progress.core, { checked: 1, total: 2 });
});

test("the core flow goes first while it has unticked items", () => {
  const progress = parseTestProgress(group("Core flow", true, false) + group("Edge cases", false));
  assert.equal(nextVerifyGroup(progress)?.heading, "Core flow");
  // "All" while the core flow is open is not offered: the core flow runs alone.
  assert.equal(canVerifyAllGroups(progress), false);
});

test("a ticked core flow hands over to the next group with unticked items", () => {
  const progress = parseTestProgress(
    group("Core flow", true, true) + group("Edge cases", true) + group("Dark mode", false) + group("Regression", false)
  );
  // Edge cases is fully ticked, so a custom heading is next — no names hard-coded.
  assert.equal(nextVerifyGroup(progress)?.heading, "Dark mode");
  assert.deepEqual(verifyTargets(progress, "all").map((g) => g.heading), ["Dark mode", "Regression"]);
  assert.equal(canVerifyAllGroups(progress), true);
  assert.equal(untickedIn(verifyTargets(progress, "all")), 2);
});

test("one group left: all and next are the same press", () => {
  const progress = parseTestProgress(group("Temel akış", true) + group("Kenar durumlar", false, false));
  assert.equal(nextVerifyGroup(progress)?.heading, "Kenar durumlar");
  assert.equal(canVerifyAllGroups(progress), false);
});

test("nothing left, or no core heading: no target", () => {
  assert.equal(nextVerifyGroup(parseTestProgress(group("Core flow", true) + group("Edge cases", true))), null);
  assert.equal(nextVerifyGroup(parseTestProgress(group("Steps", false) + group("Edge cases", false))), null);
});

test("items above the first heading belong to no group", () => {
  const html = `<ul data-type="taskList">${item(false)}</ul>` + group("Core flow", true) + group("Regression", false);
  const progress = parseTestProgress(html)!;
  assert.equal(progress.total, 3);
  assert.deepEqual(progress.groups.map((g) => g.heading), ["Core flow", "Regression"]);
  assert.equal(nextVerifyGroup(progress)?.heading, "Regression");
});

test("a repeated heading is named by which one it is", () => {
  const progress = parseTestProgress(group("Core flow", true) + group("Regression", true) + group("Regression", false))!;
  const next = nextVerifyGroup(progress)!;
  assert.equal(next.occurrence, 2);
  assert.equal(describeTestGroup(next, progress.groups), "the 2nd `## Regression` group");
  assert.equal(describeTestGroup(progress.groups[0], progress.groups), "`## Core flow`");
});

test("the UI names the contract's groups in English, whatever language the checklist is in", () => {
  const progress = parseTestProgress(
    group("Temel akış", true) + group("Kenar durumlar", false) + group("Regresyon", false) + group("Dark mode", false)
  )!;
  assert.deepEqual(progress.groups.map(testGroupLabel), ["Core flow", "Edge cases", "Regression", "Dark mode"]);
  // The prompt still names the heading as written: that is what the agent looks for.
  assert.equal(describeTestGroup(progress.groups[1], progress.groups), "`## Kenar durumlar`");
});
