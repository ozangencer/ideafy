import test from "node:test";
import assert from "node:assert/strict";

import * as cardGroupNs from "../../lib/card-group";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { collapseColumnFolds, expandColumnFolds, groupFoldKey, STALE_GROUP_ID } = interop(cardGroupNs);

test("collapseColumnFolds drops only the target column's chain rows", () => {
  const { expandedGroups } = collapseColumnFolds(
    [groupFoldKey("g1", "backlog"), groupFoldKey("g1", "ideation"), groupFoldKey("g2", "backlog")],
    [],
    "backlog"
  );
  assert.deepEqual(expandedGroups, ["g1:ideation"]);
});

test("collapseColumnFolds folds the column's Stale row too", () => {
  const { expandedGroups } = collapseColumnFolds(
    [groupFoldKey(STALE_GROUP_ID, "backlog"), groupFoldKey(STALE_GROUP_ID, "progress")],
    [],
    "backlog"
  );
  assert.deepEqual(expandedGroups, ["stale:progress"]);
});

test("collapseColumnFolds re-caps only the target column", () => {
  const { uncappedColumns } = collapseColumnFolds([], ["backlog", "ideation"], "backlog");
  assert.deepEqual(uncappedColumns, ["ideation"]);
});

test("collapseColumnFolds on empty state returns empty state", () => {
  assert.deepEqual(collapseColumnFolds([], [], "backlog"), {
    expandedGroups: [],
    uncappedColumns: [],
  });
});

test("collapseColumnFolds matches the whole column id, not a prefix of it", () => {
  const { expandedGroups } = collapseColumnFolds(["g1:backlogx", "g1:backlog"], [], "backlog");
  assert.deepEqual(expandedGroups, ["g1:backlogx"]);
});

test("expandColumnFolds opens the given keys and leaves other columns alone", () => {
  const { expandedGroups } = expandColumnFolds(
    [groupFoldKey("g1", "ideation")],
    [],
    "backlog",
    [groupFoldKey("g1", "backlog"), groupFoldKey("g2", "backlog")]
  );
  assert.deepEqual(expandedGroups, ["g1:ideation", "g1:backlog", "g2:backlog"]);
});

test("expandColumnFolds does not add a key twice", () => {
  const { expandedGroups } = expandColumnFolds(
    [groupFoldKey("g1", "backlog")],
    [],
    "backlog",
    [groupFoldKey("g1", "backlog"), groupFoldKey("g2", "backlog"), groupFoldKey("g2", "backlog")]
  );
  assert.deepEqual(expandedGroups, ["g1:backlog", "g2:backlog"]);
});

test("expandColumnFolds lifts the target column's cap once", () => {
  assert.deepEqual(expandColumnFolds([], ["ideation"], "backlog", []).uncappedColumns, [
    "ideation",
    "backlog",
  ]);
  assert.deepEqual(expandColumnFolds([], ["backlog"], "backlog", []).uncappedColumns, ["backlog"]);
});

test("collapseColumnFolds undoes expandColumnFolds", () => {
  const expanded = expandColumnFolds(["g1:ideation"], ["ideation"], "backlog", [
    "g1:backlog",
    "g2:backlog",
  ]);
  assert.deepEqual(collapseColumnFolds(expanded.expandedGroups, expanded.uncappedColumns, "backlog"), {
    expandedGroups: ["g1:ideation"],
    uncappedColumns: ["ideation"],
  });
});
