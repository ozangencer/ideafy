// The database surface every card operation in lib/card-ops/ writes through.
//
// Two drivers sit behind it: the app's better-sqlite3 connection (lib/db's
// sqlite()) and the MCP server's node:sqlite one (mcp-server/db.ts). Both
// offer prepare().run/get/all and exec, so an operation written against
// SqlDb runs unchanged in the app and in a terminal session. Rows come back as
// unknown and callers cast them, the way better-sqlite3 typed them.
//
// The drivers differ in three places, and the helpers below close each one so
// an operation never has to know which driver it got:
// - node:sqlite returns `changes` / `lastInsertRowid` as bigint when they are
//   large; runChanges() hands back numbers.
// - node:sqlite rows are null-prototype objects; getRow()/allRows() copy them
//   into plain ones, so a spread or a deepEqual behaves the same on both.
// - neither driver nests transactions the same way; transaction() turns a
//   nested call into a savepoint on both.
//
// Must never import lib/db, drizzle or better-sqlite3: the MCP bundle pulls
// this file in, and mcp-server/__tests__/bundle-deps.test.ts fails the build
// if any of them reach it.

export interface Statement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqlDb {
  prepare(sql: string): Statement;
  exec(sql: string): void;
}

export function runChanges(
  db: SqlDb,
  sql: string,
  ...params: unknown[]
): { changes: number; lastInsertRowid: number } {
  const result = db.prepare(sql).run(...params);
  return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
}

export function getRow<T>(db: SqlDb, sql: string, ...params: unknown[]): T | undefined {
  const row = db.prepare(sql).get(...params);
  return row ? ({ ...(row as object) } as T) : undefined;
}

export function allRows<T>(db: SqlDb, sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...params).map((row) => ({ ...(row as object) }) as T);
}

const depth = new WeakMap<SqlDb, number>();

// Runs fn in a transaction and returns its result, rolling back on throw.
// Nested calls become savepoints, as better-sqlite3's db.transaction() did —
// moveCardInChain runs on its own and inside update_card's transaction.
//
// The depth is only this function's own. In the app, a card-ops call made
// from inside a drizzle db.transaction() block would try BEGIN IMMEDIATE a
// second time and throw; call it outside the drizzle transaction instead.
export function transaction<T>(db: SqlDb, fn: () => T): T {
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
