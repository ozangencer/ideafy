import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";

// A card group is written in one place, lib/card-ops/groups.ts: the app's
// /api/card-groups routes and the MCP's group tools both call it. Before
// IDE-434 each side kept its own copy and they drifted — the app trimmed a
// code the MCP normalised, a terminal-made group came out without the
// picker's color, and the MCP had no delete. This keeps a third copy from
// landing.

const MCP_DIR = new URL("../", import.meta.url);
const GROUP_ROUTES = new URL("../../app/api/card-groups/", import.meta.url);

/** Raw SQL that writes a group or a chain position. */
export function rawGroupWrites(source: string): string[] {
  const patterns = [
    /INSERT\s+INTO\s+card_groups\b/gi,
    /UPDATE\s+card_groups\b/gi,
    /DELETE\s+FROM\s+card_groups\b/gi,
    /SET\s+group_order\b/gi,
  ];
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((m) => m[0].replace(/\s+/g, " ")));
}

/** Drizzle writes to the groups table, for the app's routes. */
export function drizzleGroupWrites(source: string): string[] {
  return [...source.matchAll(/\.(insert|update|delete)\(\s*schema\.cardGroups\s*\)/g)].map((m) => m[0]);
}

function tsFiles(dir: URL): URL[] {
  const files: URL[] = [];
  for (const name of readdirSync(dir)) {
    const url = new URL(name, dir);
    if (statSync(url).isDirectory()) files.push(...tsFiles(new URL(`${name}/`, dir)));
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) files.push(url);
  }
  return files;
}

test("the checkers catch a raw and a drizzle group write", () => {
  assert.equal(rawGroupWrites("db.prepare(`INSERT INTO card_groups (id) VALUES (?)`)").length, 1);
  assert.equal(rawGroupWrites("`UPDATE cards SET group_order = ? WHERE id = ?`").length, 1);
  assert.equal(rawGroupWrites("`SELECT * FROM card_groups`").length, 0);
  assert.equal(drizzleGroupWrites("db.delete(schema.cardGroups).where(x)").length, 1);
  assert.equal(drizzleGroupWrites("db.select().from(schema.cardGroups)").length, 0);
});

test("no MCP file writes a group or a chain position with its own SQL", () => {
  const offenders: string[] = [];
  // Top level only: __tests__ seeds its fixtures with raw SQL on purpose.
  for (const name of readdirSync(MCP_DIR)) {
    if (!name.endsWith(".ts") || name.endsWith(".d.ts")) continue;
    const source = readFileSync(new URL(name, MCP_DIR), "utf8");
    for (const write of rawGroupWrites(source)) offenders.push(`${name}: ${write}`);
  }
  assert.deepEqual(
    offenders,
    [],
    "Write groups through lib/card-ops (createGroup, updateGroup, deleteGroup, moveCardInChain) instead:\n" +
      offenders.join("\n")
  );
});

test("the app's group routes write through lib/card-ops, not drizzle or raw SQL", () => {
  const offenders: string[] = [];
  for (const file of tsFiles(GROUP_ROUTES)) {
    const source = readFileSync(file, "utf8");
    for (const write of [...drizzleGroupWrites(source), ...rawGroupWrites(source)]) {
      offenders.push(`${file.pathname.split("app/api/")[1]}: ${write}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "Call lib/card-ops' group functions with sqlite() instead:\n" + offenders.join("\n")
  );
});
