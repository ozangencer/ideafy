import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Drives scripts/verify-server.mjs as a CLI, the way an AI session does,
// against a throwaway repo and registry. The server is a stand-in: a tiny
// HTTP listener with a `sleep` beside it, so the process group has a child
// that must die with the leader.

const SCRIPT = fileURLToPath(new URL("../../scripts/verify-server.mjs", import.meta.url));
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "verify-server-test-")));
const repo = path.join(root, "repo");
const sourceDb = path.join(root, "source.db");
const env = {
  ...process.env,
  IDEAFY_VERIFY_REGISTRY: path.join(root, "verify-servers.json"),
  IDEAFY_VERIFY_SCRATCH_ROOT: path.join(root, "scratch"),
  IDEAFY_VERIFY_TICK_MS: "200",
};

const FAKE_SERVER =
  'sleep 600 & exec node -e "require(\\"http\\").createServer((q,r)=>r.end(\\"ok\\")).listen(process.env.PORT,\\"127.0.0.1\\")"';

fs.mkdirSync(repo);
execFileSync("git", ["init", "-q"], { cwd: repo });
fs.writeFileSync(path.join(repo, "README"), "x\n");
execFileSync("git", ["add", "README"], { cwd: repo });
execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: repo });

{
  const db = new DatabaseSync(sourceDb);
  db.exec(`
    CREATE TABLE projects (id TEXT, folder_path TEXT, id_prefix TEXT);
    CREATE TABLE cards (id TEXT, project_id TEXT, project_folder TEXT, task_number INTEGER);
    CREATE TABLE chat_sessions (id TEXT, card_id TEXT);
  `);
  db.prepare("INSERT INTO projects VALUES ('p1', ?, 'IDE')").run(repo);
  db.prepare("INSERT INTO cards VALUES ('c430', 'p1', ?, 430), ('c431', 'p1', ?, 431)").run(repo, repo);
  db.exec("INSERT INTO chat_sessions VALUES ('s430', 'c430'), ('s431', 'c431')");
  db.close();
}

after(() => {
  try {
    cli("stop", "--all");
  } catch {}
  fs.rmSync(root, { recursive: true, force: true });
});

function cli(...args: string[]): string {
  return execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", SCRIPT, ...args],
    { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
}

interface Entry {
  id: string;
  card: string;
  port: number;
  serverPid: number | null;
  watcherPid: number | null;
  worktree: string;
  scratchDir: string;
  keptDirty?: boolean;
  stopReason?: string;
}

function registry(): Entry[] {
  try {
    return JSON.parse(fs.readFileSync(env.IDEAFY_VERIFY_REGISTRY, "utf8")).servers;
  } catch {
    return [];
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function groupMembers(pgid: number): number[] {
  try {
    return execFileSync("pgrep", ["-g", String(pgid)], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
}

function worktrees(): string {
  return execFileSync("git", ["worktree", "list"], { cwd: repo, encoding: "utf8" });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const giveUp = Date.now() + ms;
  while (Date.now() < giveUp) {
    if (check()) return;
    await sleep(100);
  }
  assert.fail("condition never became true");
}

function start(card: string, ...extra: string[]): Entry {
  const out = cli("start", "--card", card, "--repo", repo, "--db", sourceDb, "--command", FAKE_SERVER, ...extra);
  assert.match(out, /is up/);
  const entry = registry().find((e) => e.card === card && !e.keptDirty);
  assert.ok(entry, "entry registered");
  assert.ok(entry.serverPid && entry.watcherPid, "pids recorded");
  return entry;
}

test("verify-server: the hard deadline stops the group, removes the worktree and drops the entry", async () => {
  // 2 seconds; idle check off so only the deadline can fire.
  const entry = start("IDE-430", "--max-hours", String(2 / 3600), "--idle-min", "0");
  const members = groupMembers(entry.serverPid!);
  assert.ok(members.length >= 2, "server and its child share a group");
  assert.match(worktrees(), new RegExp(entry.id));

  await until(() => registry().length === 0);

  for (const pid of members) assert.equal(alive(pid), false, `pid ${pid} survived`);
  assert.equal(alive(entry.watcherPid!), false);
  assert.equal(fs.existsSync(entry.scratchDir), false);
  assert.doesNotMatch(worktrees(), new RegExp(entry.id));
});

test("verify-server: --ai-run repoints the copy at the worktree and drops only this card's chat", () => {
  const entry = start("IDE-430", "--ai-run");
  const copy = new DatabaseSync(path.join(entry.scratchDir, "userdata", "kanban.db"), { readOnly: true });
  assert.equal(copy.prepare("SELECT folder_path FROM projects").get().folder_path, entry.worktree);
  assert.deepEqual(
    copy.prepare("SELECT DISTINCT project_folder FROM cards").all().map((r: { project_folder: string }) => r.project_folder),
    [entry.worktree]
  );
  assert.deepEqual(
    copy.prepare("SELECT id FROM chat_sessions").all().map((r: { id: string }) => r.id),
    ["s431"]
  );
  copy.close();

  // The live DB is read, never written.
  const live = new DatabaseSync(sourceDb, { readOnly: true });
  assert.equal(live.prepare("SELECT count(*) AS n FROM chat_sessions").get().n, 2);
  live.close();

  assert.match(cli("stop", "IDE-430"), /stopped, worktree removed/);
  assert.equal(registry().length, 0);
});

test("verify-server: stop keeps a worktree with uncommitted changes and marks it", () => {
  const entry = start("IDE-431");
  fs.writeFileSync(path.join(entry.worktree, "README"), "edited\n");

  assert.match(cli("stop", String(entry.port)), /worktree kept/);

  const [kept] = registry();
  assert.equal(kept.id, entry.id);
  assert.equal(kept.keptDirty, true);
  assert.equal(kept.serverPid, null);
  assert.equal(alive(entry.serverPid!), false);
  assert.equal(fs.existsSync(entry.worktree), true);
  assert.match(cli("list"), /worktree kept/);

  // Hand-clean, as a person would after saving the change.
  execFileSync("git", ["worktree", "remove", "--force", entry.worktree], { cwd: repo });
  fs.rmSync(entry.scratchDir, { recursive: true, force: true });
  fs.writeFileSync(env.IDEAFY_VERIFY_REGISTRY, JSON.stringify({ servers: [] }));
});

test("verify-server: the idle check closes a server nobody is connected to", async () => {
  // 0.02 min = 1.2 s without an established connection.
  const entry = start("IDE-432", "--idle-min", "0.02");
  await until(() => registry().length === 0);
  assert.equal(alive(entry.serverPid!), false);
  assert.equal(fs.existsSync(entry.scratchDir), false);
});

test("verify-server: list cleans up after a watcher killed with -9", async () => {
  const entry = start("IDE-433", "--idle-min", "0");
  process.kill(entry.watcherPid!, "SIGKILL");
  await until(() => !alive(entry.watcherPid!));
  assert.equal(alive(entry.serverPid!), true, "server outlives its watcher");

  assert.match(cli("list"), /no verify servers running/);

  assert.equal(registry().length, 0);
  assert.equal(alive(entry.serverPid!), false);
  assert.equal(fs.existsSync(entry.scratchDir), false);
  assert.doesNotMatch(worktrees(), new RegExp(entry.id));
});
