import test from "node:test";
import assert from "node:assert/strict";

import * as keysNs from "../../lib/toolkit-keys";
import * as unifiedNs from "../../lib/mentions/unified-items";
import type { ToolkitItem } from "../../lib/types";

// See run-output.test.ts: lib/ modules may come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { groupToolkitByFolder, normalizeToolkitFolder, toolkitFolderNames } = interop(keysNs);
const { buildUnifiedItems } = interop(unifiedNs);

function pin(kind: "skill" | "agent", name: string, folder: string | null, order: number): ToolkitItem {
  return {
    id: `${kind}-${name}`,
    projectId: "p1",
    kind,
    name,
    source: "global",
    folder,
    order,
    createdAt: "2026-09-28T00:00:00.000Z",
  };
}

const toolkit = [
  pin("skill", "presentation", "Documentation", 0),
  pin("skill", "human-test", null, 1),
  pin("agent", "reviewer", "Code", 2),
  pin("skill", "meeting-minutes", "Documentation", 3),
];

test("toolkit folders: loose pins first, then folders alphabetically in pin order", () => {
  const groups = groupToolkitByFolder(toolkit);
  assert.deepEqual(
    groups.map((group) => [group.folder, group.items.map((item) => item.name)]),
    [
      [null, ["human-test"]],
      ["Code", ["reviewer"]],
      ["Documentation", ["presentation", "meeting-minutes"]],
    ]
  );
  assert.deepEqual(toolkitFolderNames(toolkit), ["Code", "Documentation"]);
});

test("toolkit folders: names are trimmed and whitespace-collapsed, empty means none", () => {
  assert.equal(normalizeToolkitFolder("  Meeting   notes "), "Meeting notes");
  assert.equal(normalizeToolkitFolder("   "), null);
  assert.equal(normalizeToolkitFolder(null), null);
  assert.equal(normalizeToolkitFolder("x".repeat(60))?.length, 40);
});

test("toolkit folders: the / picker lists pins in sidebar order and carries the folder", () => {
  const items = buildUnifiedItems({
    skills: ["alpha", "human-test", "meeting-minutes", "presentation"],
    mcps: [],
    agents: ["reviewer"],
    skillItems: [],
    agentItems: [],
    toolkit,
  });
  assert.deepEqual(
    items.map((item) => [item.label, item.pinned ?? false, item.folder ?? null]),
    [
      ["human-test", true, null],
      ["reviewer", true, "Code"],
      ["presentation", true, "Documentation"],
      ["meeting-minutes", true, "Documentation"],
      ["alpha", false, null],
    ]
  );
});
