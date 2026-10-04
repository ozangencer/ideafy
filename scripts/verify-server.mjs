#!/usr/bin/env node
// Verification servers that clean up after themselves (IDE-430).
//
// An AI session that verifies a change runs a second `next dev` on a copy of
// the live DB, from a detached worktree. This script does the whole recipe in
// one command and, unlike `nohup`, also takes it down again: on `stop`, when
// the hard deadline passes, or after the port has seen no connection for a
// while.
//
//   npm run verify-server -- start --card IDE-430 [--port N] [--max-hours 3]
//                                  [--idle-min 30] [--ai-run] [--ref HEAD]
//   npm run verify-server -- stop <id | port | card> | --all
//   npm run verify-server -- list [--json]
//
// `start` spawns a detached watcher (`__watch <id>`, its own session, so the
// SIGHUP of a closing Claude session never reaches it). The watcher is the
// parent of the server, which leads a process group of its own — stopping
// that group must not take the watcher with it, or nobody is left to remove
// the worktree.
//
// Registry contract (read by the orphan-server panel, IDE-431):
// ~/Library/Application Support/ideafy/verify-servers.json, overridable with
// IDEAFY_VERIFY_REGISTRY. `{ "servers": [entry] }`, each entry:
//   id          string   unique, `<card>-<stamp>`
//   card        string   display id, e.g. "IDE-430"
//   port        number
//   url         string   http://127.0.0.1:<port>
//   serverPid   number|null  also the server's process-group id
//   watcherPid  number|null
//   worktree    string   realpath of the detached worktree
//   scratchDir  string   realpath of the folder holding worktree, DB copy, log
//   repoRoot    string   repo the worktree belongs to
//   ownsWorktree boolean only then may cleanup remove it
//   startedAt   string   ISO
//   deadline    string   ISO, hard stop
//   idleMin     number   0 = no idle check
//   logPath     string
//   keptDirty   boolean? set when cleanup left a worktree with uncommitted work
//   stoppedAt / stopReason  set together with keptDirty

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stopProcessGroup } from "../lib/process-group.ts";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_REPO = path.resolve(path.dirname(SCRIPT_PATH), "..");
const IDEAFY_DATA = path.join(os.homedir(), "Library/Application Support/ideafy");

const DEFAULTS = { maxHours: 3, idleMin: 30, firstPort: 3033, readySec: 90 };

export function registryPath() {
  return process.env.IDEAFY_VERIFY_REGISTRY ?? path.join(IDEAFY_DATA, "verify-servers.json");
}

function scratchRoot() {
  return process.env.IDEAFY_VERIFY_SCRATCH_ROOT ?? path.join(os.tmpdir(), "ideafy-verify");
}

// Overridable so tests can tick in milliseconds instead of minutes.
function tickMs() {
  return Number(process.env.IDEAFY_VERIFY_TICK_MS) || 60_000;
}

// ---------------------------------------------------------------- registry

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function readRegistry() {
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath(), "utf8"));
    return Array.isArray(parsed?.servers) ? parsed.servers : [];
  } catch {
    return [];
  }
}

function writeRegistry(servers) {
  const file = registryPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Write-then-rename: a reader never sees half a file.
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ servers }, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

// Read-modify-write under a lock file, so two sessions starting servers at
// the same moment cannot drop each other's entry.
export function updateRegistry(mutate) {
  const lock = `${registryPath()}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const giveUp = Date.now() + 5000;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lock, "wx"));
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        // A holder that died mid-write leaves the lock behind.
        if (Date.now() - fs.statSync(lock).mtimeMs > 10_000) fs.rmSync(lock, { force: true });
      } catch {}
      if (Date.now() > giveUp) throw new Error(`registry lock busy: ${lock}`);
      sleepSync(25);
    }
  }
  try {
    const next = mutate(readRegistry());
    if (next) writeRegistry(next);
    return next;
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

function patchEntry(id, patch) {
  updateRegistry((servers) => servers.map((s) => (s.id === id ? { ...s, ...patch } : s)));
}

function dropEntry(id) {
  updateRegistry((servers) => servers.filter((s) => s.id !== id));
}

function findEntry(id) {
  return readRegistry().find((s) => s.id === id);
}

// ---------------------------------------------------------------- helpers

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function appendLog(entry, line) {
  try {
    fs.appendFileSync(entry.logPath, `[verify-server ${new Date().toISOString()}] ${line}\n`);
  } catch {}
}

/**
 * Whether `pid` is still the server this entry started. After a reboot the
 * PID may belong to something else entirely; that one must not be signalled.
 */
export function ownsProcess(entry, pid) {
  if (!alive(pid)) return false;
  try {
    const command = execFileSync("ps", ["-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (command.includes(entry.worktree)) return true;
  } catch {}
  try {
    const cwd = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return cwd.split("\n").some((line) => line === `n${entry.worktree}`);
  } catch {
    return false;
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function pickPort(taken) {
  for (let port = DEFAULTS.firstPort; port < DEFAULTS.firstPort + 200; port++) {
    if (taken.has(port)) continue;
    if (await portFree(port)) return port;
  }
  throw new Error("no free port from 3033 upwards");
}

function respond(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function hasConnections(port) {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:ESTABLISHED"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim().split("\n").length > 1;
  } catch {
    // lsof exits 1 when nothing matches.
    return false;
  }
}

// ---------------------------------------------------------------- cleanup

/**
 * Remove the worktree and scratch folder — but only a worktree this script
 * created, sitting under its own scratch folder, with nothing uncommitted in
 * it. Returns { keptDirty }.
 */
export function cleanupWorktree(entry) {
  if (!entry.ownsWorktree) {
    // Start failed before the worktree existed; the scratch folder is ours.
    const root = fs.existsSync(scratchRoot()) ? fs.realpathSync(scratchRoot()) : scratchRoot();
    if (!fs.existsSync(entry.worktree) && isInside(entry.scratchDir, root)) {
      fs.rmSync(entry.scratchDir, { recursive: true, force: true });
    }
    return { keptDirty: false };
  }
  if (!isInside(entry.worktree, entry.scratchDir)) return { keptDirty: false };
  if (fs.existsSync(entry.worktree)) {
    let dirty;
    try {
      dirty = git(entry.worktree, ["status", "--porcelain"])
        .split("\n")
        .filter(Boolean)
        // The node_modules symlink: `.gitignore`'s `node_modules/` only
        // matches directories, so it would make every worktree look dirty.
        .filter((line) => line !== "?? node_modules");
    } catch (error) {
      appendLog(entry, `git status failed, keeping worktree: ${error.message}`);
      return { keptDirty: true };
    }
    if (dirty.length > 0) {
      appendLog(entry, `uncommitted changes, keeping ${entry.worktree}:\n${dirty.join("\n")}`);
      return { keptDirty: true };
    }
    try {
      git(entry.repoRoot, ["worktree", "remove", "--force", entry.worktree]);
    } catch (error) {
      appendLog(entry, `git worktree remove failed: ${error.message}`);
    }
  }
  try {
    git(entry.repoRoot, ["worktree", "prune"]);
  } catch {}
  fs.rmSync(entry.scratchDir, { recursive: true, force: true });
  return { keptDirty: false };
}

/** Stop the server group, remove the worktree, settle the registry entry. */
async function teardown(entry, reason, { verifyOwner }) {
  appendLog(entry, `stopping (${reason})`);
  const pid = entry.serverPid;
  if (pid && (!verifyOwner || ownsProcess(entry, pid))) {
    await stopProcessGroup(pid);
  }
  const { keptDirty } = cleanupWorktree(entry);
  if (keptDirty) {
    patchEntry(entry.id, {
      serverPid: null,
      watcherPid: null,
      keptDirty: true,
      stoppedAt: new Date().toISOString(),
      stopReason: reason,
    });
  } else {
    dropEntry(entry.id);
  }
  return { keptDirty };
}

/**
 * Entries whose watcher is gone (killed with -9, or the Mac rebooted) are
 * cleaned up here by whoever runs the next command.
 */
export async function repairRegistry() {
  const graceForBoot = 2 * 60_000;
  for (const entry of readRegistry()) {
    if (entry.keptDirty) continue;
    const watcherGone = entry.watcherPid
      ? !alive(entry.watcherPid)
      : Date.now() - Date.parse(entry.startedAt) > graceForBoot;
    if (watcherGone) await teardown(entry, "watcher-gone", { verifyOwner: true });
  }
}

// ---------------------------------------------------------------- start

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      opts._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) opts[key] = true;
    else {
      opts[key] = next;
      i++;
    }
  }
  return opts;
}

function copyDatabase(source, target, { aiRun, card, repoRoot, worktree }) {
  // node:sqlite instead of better-sqlite3: the repo's build is often compiled
  // for Electron's ABI and will not load in system Node.
  // Loaded lazily so importing this module does not pull the experimental
  // builtin in.
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
  const src = new DatabaseSync(source, { readOnly: true });
  // VACUUM INTO, not cp: it captures the WAL as well.
  src.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  src.close();
  if (!aiRun) return;

  const db = new DatabaseSync(target);
  db.prepare("UPDATE projects SET folder_path = ? WHERE folder_path = ?").run(worktree, repoRoot);
  db.prepare("UPDATE cards SET project_folder = ? WHERE project_folder = ?").run(worktree, repoRoot);
  // A clean chat: otherwise it resumes the card's real CLI session.
  const match = /^([A-Za-z]+)-(\d+)$/.exec(card);
  if (match) {
    db.prepare(
      `DELETE FROM chat_sessions WHERE card_id IN (
         SELECT c.id FROM cards c JOIN projects p ON p.id = c.project_id
         WHERE p.id_prefix = ? AND c.task_number = ?)`
    ).run(match[1].toUpperCase(), Number(match[2]));
  } else {
    db.prepare("DELETE FROM chat_sessions WHERE card_id = ?").run(card);
  }
  db.close();
}

async function start(opts) {
  const card = typeof opts.card === "string" ? opts.card.trim() : "";
  if (!/^[A-Za-z0-9_-]+$/.test(card)) {
    throw new Error("start needs --card <display id>, e.g. --card IDE-430");
  }
  await repairRegistry();

  const repoRoot = path.resolve(typeof opts.repo === "string" ? opts.repo : DEFAULT_REPO);
  const ref = typeof opts.ref === "string" ? opts.ref : "HEAD";
  const maxHours = opts["max-hours"] !== undefined ? Number(opts["max-hours"]) : DEFAULTS.maxHours;
  const idleMin = opts["idle-min"] !== undefined ? Number(opts["idle-min"]) : DEFAULTS.idleMin;
  const readySec = opts["ready-sec"] !== undefined ? Number(opts["ready-sec"]) : DEFAULTS.readySec;
  if (!(maxHours > 0)) throw new Error("--max-hours must be > 0");
  if (!(idleMin >= 0)) throw new Error("--idle-min must be >= 0");

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
  fs.mkdirSync(scratchRoot(), { recursive: true });
  const scratchDir = fs.mkdtempSync(path.join(scratchRoot(), `${card}-${stamp}-`));
  const scratchReal = fs.realpathSync(scratchDir);
  const worktree = path.join(scratchReal, "app");
  const userData = path.join(scratchReal, "userdata");
  // A second `next dev` inside the live repo clobbers its `.next`.
  if (worktree === repoRoot || isInside(worktree, fs.realpathSync(repoRoot))) {
    throw new Error(`refusing to run inside ${repoRoot}; point IDEAFY_VERIFY_SCRATCH_ROOT elsewhere`);
  }

  const taken = new Set(readRegistry().map((s) => s.port));
  const port = opts.port !== undefined ? Number(opts.port) : await pickPort(taken);
  if (!Number.isInteger(port) || port <= 0) throw new Error("--port must be a number");
  if (opts.port !== undefined && !(await portFree(port))) throw new Error(`port ${port} is taken`);

  const startedAt = new Date();
  const entry = {
    id: path.basename(scratchReal),
    card,
    port,
    url: `http://127.0.0.1:${port}`,
    serverPid: null,
    watcherPid: null,
    worktree,
    scratchDir: scratchReal,
    repoRoot,
    ownsWorktree: false,
    startedAt: startedAt.toISOString(),
    deadline: new Date(startedAt.getTime() + maxHours * 3_600_000).toISOString(),
    idleMin,
    logPath: path.join(scratchReal, "server.log"),
  };
  if (typeof opts.command === "string") entry.command = opts.command;
  // Registered before anything heavy, so a crash below is still cleaned up.
  updateRegistry((servers) => [...servers, entry]);

  try {
    git(repoRoot, ["worktree", "add", "--detach", worktree, ref]);
    entry.ownsWorktree = true;
    patchEntry(entry.id, { ownsWorktree: true });
    const modules = path.join(repoRoot, "node_modules");
    if (fs.existsSync(modules)) fs.symlinkSync(modules, path.join(worktree, "node_modules"));

    fs.mkdirSync(userData, { recursive: true });
    const sourceDb = typeof opts.db === "string" ? opts.db : path.join(IDEAFY_DATA, "kanban.db");
    if (!opts["no-db"]) {
      copyDatabase(sourceDb, path.join(userData, "kanban.db"), {
        aiRun: Boolean(opts["ai-run"]),
        card,
        repoRoot,
        worktree,
      });
    }
  } catch (error) {
    await teardown(entry, "start-failed", { verifyOwner: false });
    throw error;
  }

  const watcher = spawn(process.execPath, [...process.execArgv, SCRIPT_PATH, "__watch", entry.id], {
    detached: true,
    stdio: "ignore",
  });
  watcher.unref();
  patchEntry(entry.id, { watcherPid: watcher.pid });

  const readyBy = Date.now() + readySec * 1000;
  while (Date.now() < readyBy) {
    if (await respond(entry.url)) {
      console.log(`verify server ${entry.id} is up`);
      console.log(`  url:      ${entry.url}`);
      console.log(`  card:     ${card}`);
      console.log(`  worktree: ${worktree}`);
      console.log(`  log:      ${entry.logPath}`);
      console.log(`  closes:   ${idleMin ? `after ${idleMin} min idle, ` : ""}at the latest ${entry.deadline}`);
      console.log(`  stop:     npm run verify-server -- stop ${card}`);
      return 0;
    }
    if (!findEntry(entry.id)) break; // The watcher already gave up.
    await sleep(500);
  }

  console.error(`verify server ${entry.id} did not answer on ${entry.url} within ${readySec}s`);
  try {
    console.error(fs.readFileSync(entry.logPath, "utf8").split("\n").slice(-30).join("\n"));
  } catch {}
  await stopEntries([findEntry(entry.id)].filter(Boolean));
  return 1;
}

// ---------------------------------------------------------------- watcher

async function watch(id) {
  const entry = findEntry(id);
  if (!entry) return 1;

  const log = fs.openSync(entry.logPath, "a");
  const env = {
    ...process.env,
    IDEAFY_USER_DATA: path.join(entry.scratchDir, "userdata"),
    IDEAFY_APP_RESOURCES: entry.worktree,
    IDEAFY_PORT: String(entry.port),
    PORT: String(entry.port),
  };
  const [cmd, args] = entry.command
    ? ["sh", ["-c", entry.command]]
    : [
        path.join(entry.worktree, "node_modules/.bin/next"),
        ["dev", "-H", "127.0.0.1", "-p", String(entry.port)],
      ];
  // detached: the server leads its own group, so stopping that group leaves
  // this watcher alive to finish the cleanup.
  const server = spawn(cmd, args, { cwd: entry.worktree, env, detached: true, stdio: ["ignore", log, log] });

  let exited = false;
  server.on("exit", () => (exited = true));
  server.on("error", (error) => {
    appendLog(entry, `spawn failed: ${error.message}`);
    exited = true;
  });

  entry.serverPid = server.pid ?? null;
  entry.watcherPid = process.pid;
  patchEntry(id, { serverPid: entry.serverPid, watcherPid: process.pid });
  appendLog(entry, `server pid ${entry.serverPid} on ${entry.url}, deadline ${entry.deadline}`);

  let stopRequested = null;
  let wake = () => {};
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      stopRequested = "stopped";
      wake();
    });
  }
  process.on("SIGHUP", () => {});

  const deadline = Date.parse(entry.deadline);
  let lastActive = Date.now();
  let reason = null;
  while (!reason) {
    await new Promise((resolve) => {
      wake = resolve;
      setTimeout(resolve, Math.max(0, Math.min(tickMs(), deadline - Date.now())));
    });
    if (stopRequested) reason = stopRequested;
    else if (exited) reason = "server-exited";
    else if (Date.now() >= deadline) reason = "deadline";
    else if (entry.idleMin > 0) {
      if (hasConnections(entry.port)) lastActive = Date.now();
      else if (Date.now() - lastActive >= entry.idleMin * 60_000) reason = "idle";
    }
  }

  await teardown(findEntry(id) ?? entry, reason, { verifyOwner: false });
  return 0;
}

// ---------------------------------------------------------------- stop / list

function matches(entry, target) {
  const t = String(target).toLowerCase();
  return entry.id.toLowerCase() === t || String(entry.port) === t || entry.card.toLowerCase() === t;
}

async function stopEntries(entries) {
  let failed = 0;
  for (const entry of entries) {
    if (entry.keptDirty) {
      console.log(`${entry.id}: already stopped; worktree kept because of uncommitted changes: ${entry.worktree}`);
      continue;
    }
    if (entry.watcherPid && alive(entry.watcherPid)) {
      process.kill(entry.watcherPid, "SIGTERM");
      const giveUp = Date.now() + 10_000;
      while (Date.now() < giveUp) {
        const current = findEntry(entry.id);
        if (!current || current.keptDirty) break;
        await sleep(200);
      }
    }
    const current = findEntry(entry.id);
    if (current && !current.keptDirty) {
      // The watcher did not finish in time; finish for it.
      if (current.watcherPid && alive(current.watcherPid)) process.kill(current.watcherPid, "SIGKILL");
      await teardown(current, "stopped", { verifyOwner: true });
    }
    const after = findEntry(entry.id);
    if (!after) console.log(`${entry.id}: stopped, worktree removed`);
    else if (after.keptDirty) console.log(`${entry.id}: stopped; worktree kept because of uncommitted changes: ${after.worktree}`);
    else failed++;
  }
  return failed ? 1 : 0;
}

async function stop(opts) {
  await repairRegistry();
  const servers = readRegistry();
  const target = opts._[0];
  if (!opts.all && target === undefined) throw new Error("stop needs <id | port | card> or --all");
  const picked = opts.all ? servers : servers.filter((s) => matches(s, target));
  if (picked.length === 0) {
    console.log(opts.all ? "no verify servers running" : `no verify server matches ${target}`);
    return 0;
  }
  return stopEntries(picked);
}

function duration(ms) {
  const min = Math.max(0, Math.round(ms / 60_000));
  return min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}m` : `${min}m`;
}

async function list(opts) {
  await repairRegistry();
  const servers = readRegistry();
  if (opts.json) {
    console.log(JSON.stringify({ servers }, null, 2));
    return 0;
  }
  if (servers.length === 0) {
    console.log("no verify servers running");
    return 0;
  }
  const now = Date.now();
  for (const s of servers) {
    const state = s.keptDirty
      ? "stopped, worktree kept (uncommitted changes)"
      : `up ${duration(now - Date.parse(s.startedAt))}, closes in ${duration(Date.parse(s.deadline) - now)}`;
    console.log(`${s.card}  :${s.port}  ${state}  ${s.worktree}  [${s.id}]`);
  }
  return 0;
}

// ---------------------------------------------------------------- main

export async function main(argv) {
  const [command, ...rest] = argv;
  const opts = parseArgs(rest);
  switch (command) {
    case "start":
      return start(opts);
    case "stop":
      return stop(opts);
    case "list":
      return list(opts);
    case "__watch":
      return watch(opts._[0]);
    default:
      console.error("usage: verify-server start --card <ID> [--ai-run] | stop <id|port|card> | stop --all | list");
      return 2;
  }
}

const invokedDirectly = (() => {
  try {
    return fs.realpathSync(process.argv[1] ?? "") === fs.realpathSync(SCRIPT_PATH);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code ?? 0),
    (error) => {
      console.error(`verify-server: ${error.message}`);
      process.exit(1);
    }
  );
}
