import { createRequire } from "node:module";
import type { SqlDb } from "./shared.js";

// The MCP server talks to SQLite through Node's built-in `node:sqlite`, not
// better-sqlite3. Claude Code installs plugin dependencies with
// `npm ci --ignore-scripts`, so a native addon never gets its binary and the
// server died on start with "Could not locate the bindings file". A built-in
// module has nothing to install.
//
// Db is lib/card-ops' SqlDb plus close(): the same surface the app's
// better-sqlite3 connection offers, so the shared card operations run on
// either. The driver differences (bigint counts, null-prototype rows, nested
// transactions) are closed in lib/card-ops/db.ts.
export type { Statement } from "./shared.js";
export { transaction } from "./shared.js";

export interface Db extends SqlDb {
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
