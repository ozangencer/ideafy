import type { SqlDb } from "./shared.js";

// What the database this server opened can store.
//
// The MCP server runs no migrations, and the plugin and the app update
// independently, in either order — so the plugin can be newer than the
// database it writes to. The shared card operations in lib/card-ops/ always
// assume the current schema; the old-database question is answered here, at
// the MCP's edge, and nowhere else. A tool checks the capability it needs
// before calling a card-ops function and, when it is missing, returns
// "update the app" instead of half-writing an old schema.
//
// Each capability is one column, probed with PRAGMA table_info. A hit is
// cached for the life of the connection: a column does not go away without a
// destructive migration. A miss is re-probed on every call, so an app updated
// while this server was already running is noticed on the next attempt rather
// than at the next restart. table_info on one table costs microseconds.

const CAPABILITIES = {
  /** completed_at — stamped when a card enters Completed. */
  completedAt: ["cards", "completed_at"],
  /** output_paths (0012) — files a Work card produced, recorded by save_output. */
  outputPaths: ["cards", "output_paths"],
  /** group_order (0016) — a card's manual position in its chain. */
  groupOrder: ["cards", "group_order"],
  /** git_branch_status — whether a card's branch is merged, for list_open_work. */
  branchStatus: ["cards", "git_branch_status"],
  /** ai_score (0021) — the opinion's Final Score, written by save_opinion. */
  aiScore: ["cards", "ai_score"],
} as const satisfies Record<string, readonly [string, string]>;

export type Capability = keyof typeof CAPABILITIES;

const knownColumns = new WeakMap<SqlDb, Set<string>>();

// Whether `table` has `column`. Kept for the tests and for one-off probes;
// tools ask by capability.
export function hasColumn(db: SqlDb, table: string, column: string): boolean {
  const key = `${table}.${column}`;
  let known = knownColumns.get(db);
  if (!known) {
    known = new Set();
    knownColumns.set(db, known);
  }
  if (known.has(key)) return true;

  const rows = db
    .prepare(`PRAGMA table_info(${JSON.stringify(table)})`)
    .all() as Array<{ name: string }>;
  const present = rows.some((row) => row.name === column);
  if (present) known.add(key);
  return present;
}

export function hasCapability(db: SqlDb, capability: Capability): boolean {
  const [table, column] = CAPABILITIES[capability];
  return hasColumn(db, table, column);
}

/**
 * The tool result for a write the database cannot take yet. Nothing was
 * written; the app adds the column on its next start.
 */
export function missingCapabilityMessage(tool: string, capability: Capability): string {
  const [table, column] = CAPABILITIES[capability];
  return (
    `${tool}: this Ideafy database cannot store ${table}.${column} yet. ` +
    `Update the Ideafy app — it adds the column on its next start — then call ${tool} again. Nothing was written.`
  );
}
