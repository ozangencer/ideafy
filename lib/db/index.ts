import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { appResourcesRoot, resolveUserDataDir } from "../paths";

const DB_FILENAME = "kanban.db";

// Resolve the on-disk DB file. Packaged DMG: ~/Library/Application Support/
// ideafy/kanban.db (via IDEAFY_USER_DATA). Dev: repo/data/kanban.db.
// First-run migration: if userData has no DB but a legacy repo DB exists,
// copy it over so existing users don't lose history when they upgrade to
// the packaged build.
function resolveDbPath(): string {
  const userDataDir = resolveUserDataDir();
  const target = path.join(userDataDir, DB_FILENAME);

  if (!fs.existsSync(target)) {
    const legacy = path.join(process.cwd(), "data", DB_FILENAME);
    const sameFile = path.resolve(legacy) === path.resolve(target);
    if (!sameFile && fs.existsSync(legacy)) {
      fs.copyFileSync(legacy, target);
      console.log(`[db] migrated legacy DB from ${legacy} → ${target}`);
    }
  }
  return target;
}

// Drizzle's migrate() expects every pending migration to be fresh — it will
// replay the SQL and crash on "table already exists". Two legacy paths leave
// a DB where migrations were applied out-of-band (via `drizzle-kit push` or
// a previous hand-edit) but the tracker is missing or incomplete:
//   1. No __drizzle_migrations table at all (pre-migration era).
//   2. Tracker exists but later migrations' tables were created via push.
// For every journal entry whose first CREATE TABLE target already exists on
// disk and whose hash isn't recorded yet, stamp it as applied.
function stampExistingMigrations(
  sqlite: Database.Database,
  migrationsFolder: string
): void {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  if (!fs.existsSync(journalPath)) return;

  const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as {
    entries: Array<{ tag: string; when: number }>;
  };
  if (!journal.entries?.length) return;

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    );
  `);

  const applied = new Set<string>(
    sqlite
      .prepare<[], { hash: string }>(`SELECT hash FROM __drizzle_migrations`)
      .all()
      .map((row) => row.hash)
  );

  const tableExists = sqlite.prepare<[string], { name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
  );

  const columnExists = (table: string, column: string): boolean => {
    if (!tableExists.get(table)) return false;
    const rows = sqlite
      .prepare<[], { name: string }>(`PRAGMA table_info(${JSON.stringify(table)})`)
      .all();
    return rows.some((row) => row.name === column);
  };

  const crypto = require("node:crypto") as typeof import("node:crypto");
  const insert = sqlite.prepare(
    `INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`
  );

  for (const entry of journal.entries) {
    const sqlFile = path.join(migrationsFolder, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlFile)) continue;
    const sql = fs.readFileSync(sqlFile, "utf-8");
    const hash = crypto.createHash("sha256").update(sql).digest("hex");
    if (applied.has(hash)) continue;

    let stampReason: string | null = null;

    const createMatch = sql.match(
      /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?[`"']?([A-Za-z0-9_]+)[`"']?/i
    );
    if (createMatch && tableExists.get(createMatch[1])) {
      stampReason = `target table '${createMatch[1]}' already present`;
    }

    // Also handle ALTER TABLE ... ADD [COLUMN] migrations: stamp the entry
    // if every added column already exists on the target table. Without this
    // a DB that picked up the column via `drizzle-kit push` (or an earlier
    // hand-edit) would replay the ALTER and crash with "duplicate column".
    if (!stampReason) {
      const alterMatches = Array.from(
        sql.matchAll(
          /ALTER TABLE\s+[`"']?([A-Za-z0-9_]+)[`"']?\s+ADD\s+(?:COLUMN\s+)?[`"']?([A-Za-z0-9_]+)[`"']?/gi
        )
      );
      if (alterMatches.length > 0 && alterMatches.every(([, t, c]) => columnExists(t, c))) {
        const cols = alterMatches.map(([, t, c]) => `${t}.${c}`).join(", ");
        stampReason = `added column(s) ${cols} already present`;
      }
    }

    if (!stampReason) continue;

    insert.run(hash, entry.when);
    applied.add(hash);
    console.log(`[db] stamped existing migration ${entry.tag} (${stampReason})`);
  }
}

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let cachedDb: DrizzleDb | null = null;

function initDb(): DrizzleDb {
  if (cachedDb) return cachedDb;

  const dbPath = resolveDbPath();
  const sqlite = new Database(dbPath);

  // WAL lets the Next server and the MCP server read/write the same file
  // concurrently without blocking each other. Without it the MCP process
  // would throw SQLITE_BUSY whenever the UI is saving.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  // 5s busy timeout absorbs short overlaps between the Next server and the
  // MCP server when they both touch the file at startup.
  sqlite.pragma("busy_timeout = 5000");

  const migrationsFolder = path.join(appResourcesRoot(), "drizzle");
  if (fs.existsSync(migrationsFolder)) {
    stampExistingMigrations(sqlite, migrationsFolder);
    migrate(drizzle(sqlite), { migrationsFolder });
  }

  cachedDb = drizzle(sqlite, { schema });
  return cachedDb;
}

// `next build` collects page data by importing every route module in
// parallel workers and invoking each handler. If we open SQLite at module
// load (or on the first handler call), every worker races on `new Database`
// + WAL setup + migrate(), and one of them crashes the build with
// "database is locked". Defer DB initialisation until an actual request
// runs, and during the build phase throw a Next-recognised
// DYNAMIC_SERVER_USAGE error so static analysis falls back to dynamic
// rendering instead of failing.
const isNextBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop, receiver) {
    if (isNextBuildPhase) {
      const err: Error & { digest?: string } = new Error(
        "Dynamic server usage: route reads SQLite at request time"
      );
      err.digest = "DYNAMIC_SERVER_USAGE";
      throw err;
    }
    const real = initDb();
    return Reflect.get(real, prop, receiver);
  },
});

export { schema };
