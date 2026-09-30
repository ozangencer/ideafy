import { createRequire } from "node:module";

// The MCP server talks to SQLite through Node's built-in `node:sqlite`, not
// better-sqlite3. Claude Code installs plugin dependencies with
// `npm ci --ignore-scripts`, so a native addon never gets its binary and the
// server died on start with "Could not locate the bindings file". A built-in
// module has nothing to install.
//
// Db is the slice of DatabaseSync the server uses, typed the way
// better-sqlite3 was: rows come back as unknown and callers cast them.
// node:sqlite's own typings return Record<string, SQLOutputValue>, which
// would need a double cast at every query.
export interface Statement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface Db {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  close(): void;
}

const MIN_NODE = [22, 5] as const;

// Loaded lazily so an old Node reaches the version message below instead of
// failing at link time on an unknown builtin.
function loadSqlite(): typeof import("node:sqlite") {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
    throw new Error(
      `Ideafy MCP needs Node ${MIN_NODE.join(".")} or newer (found ${process.versions.node}).`
    );
  }
  try {
    return createRequire(import.meta.url)("node:sqlite");
  } catch {
    // Node 22.5–22.12 ships the module behind a flag.
    throw new Error(
      `node:sqlite is not available in Node ${process.versions.node}. Start the server with --experimental-sqlite or use Node 22.13+.`
    );
  }
}

// busy_timeout is not optional: better-sqlite3 waited 5s on a locked DB by
// default, node:sqlite waits 0, so a write landing while the app writes would
// fail straight away with SQLITE_BUSY.
export function openDatabase(path: string): Db {
  const { DatabaseSync } = loadSqlite();
  const db: Db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

const depth = new WeakMap<Db, number>();

// Runs fn in a transaction and returns its result, rolling back on throw.
// Nested calls become savepoints, as better-sqlite3's db.transaction() did —
// moveCardInChain runs on its own and inside update_card's transaction.
export function transaction<T>(db: Db, fn: () => T): T {
  const level = depth.get(db) ?? 0;
  const savepoint = `ideafy_tx_${level}`;
  db.exec(level === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
  depth.set(db, level + 1);
  try {
    const result = fn();
    db.exec(level === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    try {
      db.exec(level === 0 ? "ROLLBACK" : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
    } catch {
      // SQLite may already have rolled back on its own; the original error matters.
    }
    throw error;
  } finally {
    depth.set(db, level);
  }
}
