import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// A card's column moves through lib/card-ops (moveCard, or completedAtFor in
// update_card's combined write) so completed_at and the queue trigger behave
// the same on every path. IDE-406 and then IDE-407's follow-up both found an
// MCP tool that set `status` with its own SQL and skipped the rule — move_card
// first, then save_plan and save_tests. This keeps a new one from landing.

const MCP_DIR = new URL("../", import.meta.url);

// Every `UPDATE cards SET … WHERE` whose SET list names status, and every
// `INSERT INTO cards (…)` that writes status without completed_at.
export function rawStatusWrites(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/UPDATE\s+cards\s+SET([\s\S]*?)(?:\bWHERE\b|`)/gi)) {
    if (/\bstatus\s*=/.test(match[1])) found.push(match[0].replace(/\s+/g, " ").trim());
  }
  for (const match of source.matchAll(/INSERT\s+INTO\s+cards\s*\(([\s\S]*?)\)\s*VALUES/gi)) {
    if (/\bstatus\b/.test(match[1]) && !/\bcompleted_at\b/.test(match[1])) {
      found.push(match[0].replace(/\s+/g, " ").trim());
    }
  }
  return found;
}

test("the checker catches a raw status write", () => {
  assert.equal(rawStatusWrites("db.prepare(`UPDATE cards SET status = 'test', updated_at = ? WHERE id = ?`)").length, 1);
  assert.equal(rawStatusWrites("`INSERT INTO cards (id, status) VALUES (?, ?)`").length, 1);
  assert.equal(rawStatusWrites("`UPDATE cards SET test_scenarios = ? WHERE status = 'test'`").length, 0);
});

test("no MCP file writes a card's status with its own SQL", () => {
  const offenders: string[] = [];
  for (const name of readdirSync(MCP_DIR)) {
    if (!name.endsWith(".ts") || name.endsWith(".d.ts")) continue;
    const source = readFileSync(new URL(name, MCP_DIR), "utf8");
    for (const write of rawStatusWrites(source)) offenders.push(`${name}: ${write}`);
  }
  assert.deepEqual(
    offenders,
    [],
    "Move the card through lib/card-ops (moveCard, or completedAtFor in a combined write) instead:\n" +
      offenders.join("\n")
  );
});

// The run queue's order goes through lib/card-ops/queue.ts on both sides, so
// a terminal and the app read and rewrite it in one transaction each. An MCP
// tool writing queue_position itself would skip both the eligibility rules
// and that transaction.
export function rawQueueWrites(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/UPDATE\s+cards\s+SET([\s\S]*?)(?:\bWHERE\b|`)/gi)) {
    if (/\bqueue_position\s*=/.test(match[1])) found.push(match[0].replace(/\s+/g, " ").trim());
  }
  return found;
}

test("the checker catches a raw queue write", () => {
  assert.equal(rawQueueWrites("db.prepare(`UPDATE cards SET queue_position = ? WHERE id = ?`)").length, 1);
  assert.equal(rawQueueWrites("`UPDATE cards SET title = ? WHERE queue_position IS NOT NULL`").length, 0);
});

test("no MCP file writes a card's queue position with its own SQL", () => {
  const offenders: string[] = [];
  for (const name of readdirSync(MCP_DIR)) {
    if (!name.endsWith(".ts") || name.endsWith(".d.ts")) continue;
    const source = readFileSync(new URL(name, MCP_DIR), "utf8");
    for (const write of rawQueueWrites(source)) offenders.push(`${name}: ${write}`);
  }
  assert.deepEqual(
    offenders,
    [],
    "Queue the card through lib/card-ops (enqueueCard / dequeueCard / clearQueue) instead:\n" + offenders.join("\n")
  );
});
