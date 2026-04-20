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

// Drizzle's migrate() expects a __drizzle_migrations table to exist or the DB
// to be empty. Legacy dev installs were built via `drizzle-kit push`, so the
// schema is present but the tracker table is not — running migrate() there
// would re-CREATE tables and crash. Stamp the baseline as applied in that
// case so future migrations layer on cleanly.
function stampBaselineIfLegacy(sqlite: Database.Database, migrationsFolder: string): void {
  const hasTracker = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`)
    .get();
  if (hasTracker) return;

  const hasCards = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='cards'`)
    .get();
  if (!hasCards) return;

  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  if (!fs.existsSync(journalPath)) return;

  const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as {
    entries: Array<{ tag: string; when: number }>;
  };
  const baseline = journal.entries[0];
  if (!baseline) return;

  const sqlFile = path.join(migrationsFolder, `${baseline.tag}.sql`);
  if (!fs.existsSync(sqlFile)) return;
  const sql = fs.readFileSync(sqlFile, "utf-8");
  const hash = require("node:crypto").createHash("sha256").update(sql).digest("hex");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    );
  `);
  sqlite
    .prepare(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`)
    .run(hash, baseline.when);
  console.log(`[db] stamped baseline migration ${baseline.tag} on legacy DB`);
}

const dbPath = resolveDbPath();
const sqlite = new Database(dbPath);

// WAL lets the Next server and the MCP server read/write the same file
// concurrently without blocking each other. Without it the MCP process
// would throw SQLITE_BUSY whenever the UI is saving.
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const migrationsFolder = path.join(appResourcesRoot(), "drizzle");
if (fs.existsSync(migrationsFolder)) {
  stampBaselineIfLegacy(sqlite, migrationsFolder);
  migrate(drizzle(sqlite), { migrationsFolder });
}

export const db = drizzle(sqlite, { schema });

export { schema };
