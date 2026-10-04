import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

import type { OrphanServer } from "./types";
import { stopProcess, stopProcessGroupById } from "./process-group";

// Dev servers nobody owns any more (IDE-431). Ideafy only knows the Run
// servers whose PID it stored on a card; an AI verification, a terminal or the
// old Stop leaves `next dev` / `next-server` / `vite` behind, each holding a
// GB or two until someone notices swap filling up.
//
// The rule is deliberately narrow: a dev-server signature, running from a
// scratch folder (/tmp, $TMPDIR, a `.worktrees/` checkout) or listed in the
// verify-server registry (IDE-430), and not one of Ideafy's own Run servers or
// processes. A server someone started on purpose in their own project folder
// is never listed. Nothing is stopped without the user asking.
//
// The first half is pure (ps text in, candidates out) so tests can feed it
// fixtures; the runner below calls ps, lsof and footprint. macOS only — on
// other platforms the scan returns nothing.

const execFileAsync = promisify(execFile);

/** Open longer than this, a row gets the warning badge. */
export const STALE_AFTER_SEC = 12 * 60 * 60;

export interface PsRow {
  pid: number;
  ppid: number;
  pgid: number;
  etimeSec: number;
  command: string;
}

/** `[[dd-]hh:]mm:ss` as printed by `ps -o etime` → seconds. */
export function parseEtime(etime: string): number {
  const m = etime.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return (Number(d ?? 0) * 24 + Number(h ?? 0)) * 3600 + Number(min) * 60 + Number(s);
}

/** Output of `ps -axww -o pid=,ppid=,pgid=,etime=,command=`. */
export function parsePsOutput(text: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    rows.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      pgid: Number(m[3]),
      etimeSec: parseEtime(m[4]),
      command: m[5].trim(),
    });
  }
  return rows;
}

const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);

// `next dev` or `vite`, as handed to npm exec / npx.
function runsDevTool(args: string[]): boolean {
  const [tool, sub] = args[0] === "--" ? args.slice(1) : args;
  return (tool === "next" && sub === "dev") || tool === "vite";
}

/**
 * True for the processes a dev server is made of: `npm run dev`,
 * `npm exec next dev`, `node …/.bin/next dev`, `next-server (v…)`, vite.
 * Only the executable and its first arguments count — a `claude -p` whose
 * prompt mentions `next dev` must not match.
 */
export function matchesDevServer(command: string): boolean {
  if (/^next-server \(v/.test(command)) return true;
  const argv = command.split(/\s+/).filter(Boolean);
  const exe = base(argv[0] ?? "");

  if (exe === "npm") {
    if (argv[1] === "run") return argv[2] === "dev";
    return argv[1] === "exec" && runsDevTool(argv.slice(2));
  }
  if (exe === "npx") return runsDevTool(argv.slice(1));
  if (exe === "next") return argv[1] === "dev";
  if (exe === "vite") return true;
  if (exe === "node" || /^node\d*$/.test(exe)) {
    // `node [flags] <script> [args]`; flag values never end in next/vite.
    for (let i = 1; i < Math.min(argv.length, 6); i++) {
      const script = base(argv[i]);
      if (script === "next") return argv[i + 1] === "dev";
      if (script === "vite" || script === "vite.js") return true;
    }
  }
  return false;
}

function normalizeRoot(p: string): string {
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

/** Folders a dev server is a throwaway in: /tmp, $TMPDIR, both as typed and resolved. */
export function scratchRoots(): string[] {
  const roots = new Set(["/tmp", "/private/tmp"]);
  const tmp = os.tmpdir();
  roots.add(normalizeRoot(tmp));
  try {
    roots.add(normalizeRoot(fs.realpathSync(tmp)));
  } catch {
    // tmpdir missing is not our problem to report.
  }
  return [...roots];
}

function underRoot(dir: string, root: string): string | null {
  if (dir === root) return "";
  return dir.startsWith(root + "/") ? dir.slice(root.length + 1) : null;
}

export function isScratchFolder(cwd: string, roots: string[]): boolean {
  if (cwd.includes("/.worktrees/")) return true;
  return roots.some((root) => underRoot(cwd, root) !== null);
}

/**
 * Short name for a scratch folder: `ide387` for `$TMPDIR/ide387/app`, the
 * card folder for `$TMPDIR/ideafy-verify/IDE-430-…/app`, the worktree name
 * for `…/.worktrees/kanban/IDE-12-foo`.
 */
export function folderHint(cwd: string, roots: string[]): string {
  const wt = cwd.indexOf("/.worktrees/");
  if (wt !== -1) {
    const parts = cwd.slice(wt + "/.worktrees/".length).split("/").filter(Boolean);
    return (parts[0] === "kanban" && parts[1] ? parts[1] : parts[0]) ?? base(cwd);
  }
  for (const root of roots) {
    const rel = underRoot(cwd, root);
    if (rel === null || rel === "") continue;
    const parts = rel.split("/");
    if (parts[0] === "ideafy-verify" && parts[1]) return parts[1];
    return parts[0];
  }
  return base(cwd) || cwd;
}

export interface ClassifyContext {
  /** The process this code runs in (Ideafy's Next server or a worker of it). */
  selfPid: number;
  selfPpid: number;
  /** `devServerPid` of every card with a Run server — those have a Stop button. */
  runPids: Set<number>;
  /** Working folder per PID, for the signature matches. */
  cwds: Map<number, string>;
  /** Process groups the verify-server registry lists as its servers. */
  registryPgids: Set<number>;
  roots: string[];
}

export interface Candidate {
  /** `pgid`, or `pgid:rootPid` for a server in a group it shares. */
  id: string;
  pgid: number;
  /** Topmost process of the server. */
  rootPid: number;
  pids: number[];
  ageSec: number;
  cwd: string | null;
  /**
   * The group also holds processes that are not part of this server (Ideafy
   * itself, a terminal Claude session and its MCP servers): it must be
   * stopped PID by PID, never with a group signal.
   */
  sharedGroup: boolean;
}

/**
 * ps rows → orphaned dev-server candidates.
 *
 * A server is a matching process plus everything below it. When the servers
 * are all its process group holds, the group is the unit: the memory sits in
 * the `next-server` below `next dev`, and a group whose npm leader died still
 * carries npm's PGID. When the group holds anything else — AI runs are not
 * detached, so a server an agent left behind with `&` lands in Ideafy's or a
 * terminal session's group — each server is listed on its own and a group
 * signal is off the table.
 */
export function classifyCandidates(rows: PsRow[], ctx: ClassifyContext): Candidate[] {
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const children = new Map<number, PsRow[]>();
  for (const r of rows) {
    const list = children.get(r.ppid);
    if (list) list.push(r);
    else children.set(r.ppid, [r]);
  }

  const ancestorsOf = (pid: number): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    let cur = byPid.get(pid);
    while (cur && cur.ppid > 1 && !seen.has(cur.ppid)) {
      seen.add(cur.ppid);
      out.push(cur.ppid);
      cur = byPid.get(cur.ppid);
    }
    return out;
  };

  const subtree = (rootPid: number): PsRow[] => {
    const out: PsRow[] = [];
    const stack = [byPid.get(rootPid)!];
    while (stack.length) {
      const r = stack.pop()!;
      out.push(r);
      stack.push(...(children.get(r.pid) ?? []));
    }
    return out;
  };

  // Ideafy's own chain (its server and everything that started it) and
  // anything below it: a live AI run's server is still somebody's.
  const selfChain = new Set([ctx.selfPid, ...ancestorsOf(ctx.selfPid)]);
  const selfRoots = new Set([ctx.selfPid, ctx.selfPpid]);
  const ownPgid = byPid.get(ctx.selfPid)?.pgid ?? null;

  const matched = rows.filter(
    (r) =>
      matchesDevServer(r.command) &&
      !selfChain.has(r.pid) &&
      !ancestorsOf(r.pid).some((a) => selfRoots.has(a))
  );
  const matchedPids = new Set(matched.map((r) => r.pid));

  // Each server's root: its topmost matching ancestor within the same group.
  const rootsByPgid = new Map<number, Set<number>>();
  for (const r of matched) {
    let root = r;
    let parent = byPid.get(root.ppid);
    while (parent && matchedPids.has(parent.pid) && parent.pgid === r.pgid) {
      root = parent;
      parent = byPid.get(root.ppid);
    }
    const set = rootsByPgid.get(r.pgid) ?? new Set<number>();
    set.add(root.pid);
    rootsByPgid.set(r.pgid, set);
  }

  const units: Array<{ id: string; pgid: number; rootPid: number; members: PsRow[]; shared: boolean }> = [];
  for (const [pgid, roots] of rootsByPgid) {
    const trees = [...roots].map((root) => ({ root, members: subtree(root) }));
    const covered = new Set(trees.flatMap((t) => t.members.map((r) => r.pid)));
    const groupRows = rows.filter((r) => r.pgid === pgid);
    const dedicated = pgid !== ownPgid && groupRows.every((r) => covered.has(r.pid));
    if (dedicated) {
      const oldest = trees
        .map((t) => byPid.get(t.root)!)
        .reduce((a, b) => (b.etimeSec > a.etimeSec ? b : a));
      units.push({ id: String(pgid), pgid, rootPid: oldest.pid, members: groupRows, shared: false });
    } else {
      for (const t of trees) {
        units.push({ id: `${pgid}:${t.root}`, pgid, rootPid: t.root, members: t.members, shared: true });
      }
    }
  }

  const candidates: Candidate[] = [];
  for (const u of units) {
    if (ctx.runPids.has(u.pgid) || u.members.some((r) => ctx.runPids.has(r.pid))) continue;
    if (u.members.some((r) => selfChain.has(r.pid))) continue;

    const scratchCwd = u.members
      .filter((r) => matchedPids.has(r.pid))
      .map((r) => ctx.cwds.get(r.pid))
      .find((cwd): cwd is string => !!cwd && isScratchFolder(cwd, ctx.roots));
    const inRegistry = !u.shared && ctx.registryPgids.has(u.pgid);
    if (!scratchCwd && !inRegistry) continue;

    candidates.push({
      id: u.id,
      pgid: u.pgid,
      rootPid: u.rootPid,
      pids: u.members.map((r) => r.pid).sort((a, b) => a - b),
      ageSec: Math.max(...u.members.map((r) => r.etimeSec)),
      cwd: scratchCwd ?? ctx.cwds.get(u.rootPid) ?? null,
      sharedGroup: u.shared,
    });
  }
  return candidates;
}

/** `lsof -Fn` output → first `n` value per `p` block. */
function parseLsofNames(text: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  let pid: number | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) {
      pid = Number(line.slice(1));
      if (!out.has(pid)) out.set(pid, []);
    } else if (line.startsWith("n") && pid !== null) {
      out.get(pid)!.push(line.slice(1));
    }
  }
  return out;
}

/** `lsof -a -p … -d cwd -Fn` → folder per PID. */
export function parseLsofCwd(text: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const [pid, names] of parseLsofNames(text)) if (names[0]) out.set(pid, names[0]);
  return out;
}

/** `lsof -a -p … -iTCP -sTCP:LISTEN -P -n -Fn` → listening ports per PID. */
export function parseLsofListen(text: string): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const [pid, names] of parseLsofNames(text)) {
    const ports = names
      .map((n) => Number(n.slice(n.lastIndexOf(":") + 1)))
      .filter((p) => Number.isInteger(p) && p > 0);
    if (ports.length) out.set(pid, [...new Set(ports)].sort((a, b) => a - b));
  }
  return out;
}

/**
 * `footprint --noCategories -f bytes <pid>…` → phys_footprint per PID.
 * Footprint counts compressed memory; RSS showed a 2.25 GB process as 157 MB.
 */
export function parseFootprint(text: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const m of text.matchAll(/\[(\d+)\]:.*?Footprint:\s*(\d+)\s*B/g)) {
    out.set(Number(m[1]), Number(m[2]));
  }
  return out;
}

// ---------------------------------------------------------------- registry

export interface VerifyRegistryEntry {
  card?: string;
  port?: number;
  serverPid?: number | null;
  watcherPid?: number | null;
  deadline?: string;
  worktree?: string;
}

/**
 * IDE-430's verify-server registry, read from the path its script writes.
 * Not resolveUserDataDir(): on a DB copy IDEAFY_USER_DATA points at scratch.
 */
export function verifyRegistryPath(): string {
  return (
    process.env.IDEAFY_VERIFY_REGISTRY ??
    path.join(os.homedir(), "Library/Application Support/ideafy/verify-servers.json")
  );
}

export function readVerifyRegistry(file = verifyRegistryPath()): VerifyRegistryEntry[] {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as { servers?: unknown };
    return Array.isArray(data.servers) ? (data.servers as VerifyRegistryEntry[]) : [];
  } catch {
    return [];
  }
}

function isAlive(pid: number | null | undefined): boolean {
  if (!pid || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// ---------------------------------------------------------------- runner

async function run(cmd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    // lsof exits 1 when one of several PIDs is gone; its stdout still counts.
    return (error as { stdout?: string }).stdout ?? "";
  }
}

export interface ScanInput {
  runPids: number[];
  /** Cards with a worktree, so a server running in one is named after it. */
  worktreeCards: Array<{ cardId: string; displayId: string | null; path: string }>;
  /** Registry rows carry a display id; the route knows which card that is. */
  resolveDisplayId?: (displayId: string) => string | null;
  now?: number;
}

export interface ScannedServer extends OrphanServer {
  pids: number[];
  sharedGroup: boolean;
  watcherPid: number | null;
}

export function scanSupported(): boolean {
  return process.platform === "darwin";
}

export async function scanOrphanServers(input: ScanInput): Promise<ScannedServer[]> {
  if (!scanSupported()) return [];

  const rows = parsePsOutput(await run("ps", ["-axww", "-o", "pid=,ppid=,pgid=,etime=,command="]));
  const signature = rows.filter((r) => matchesDevServer(r.command)).map((r) => r.pid);
  // No dev server anywhere: lsof and footprint are never called.
  if (signature.length === 0) return [];

  const cwds = parseLsofCwd(await run("lsof", ["-a", "-p", signature.join(","), "-d", "cwd", "-Fn"]));
  const registry = readVerifyRegistry();
  const roots = scratchRoots();

  const candidates = classifyCandidates(rows, {
    selfPid: process.pid,
    selfPpid: process.ppid,
    runPids: new Set(input.runPids),
    cwds,
    registryPgids: new Set(registry.map((e) => e.serverPid).filter((p): p is number => !!p)),
    roots,
  });
  if (candidates.length === 0) return [];

  const allPids = [...new Set(candidates.flatMap((c) => c.pids))];
  const [listenText, footprintText] = await Promise.all([
    run("lsof", ["-a", "-p", allPids.join(","), "-iTCP", "-sTCP:LISTEN", "-P", "-n", "-Fn"]),
    run("footprint", ["--noCategories", "-f", "bytes", ...allPids.map(String)]),
  ]);
  const ports = parseLsofListen(listenText);
  const footprints = parseFootprint(footprintText);
  const now = input.now ?? Date.now();

  return candidates.map((c) => {
    const entry = c.sharedGroup ? undefined : registry.find((e) => e.serverPid === c.pgid);
    const watcherAlive = !!entry && isAlive(entry.watcherPid);
    const worktreeCard = c.cwd
      ? input.worktreeCards.find((w) => c.cwd === w.path || c.cwd!.startsWith(w.path + "/"))
      : undefined;

    const port =
      c.pids.flatMap((pid) => ports.get(pid) ?? []).sort((a, b) => a - b)[0] ?? entry?.port ?? null;
    const sizes = c.pids.map((pid) => footprints.get(pid)).filter((n): n is number => n != null);

    let label: string;
    let cardId: string | null = null;
    if (entry?.card) {
      label = entry.card;
      cardId = input.resolveDisplayId?.(entry.card) ?? null;
    } else if (worktreeCard) {
      label = worktreeCard.displayId ?? folderHint(c.cwd!, roots);
      cardId = worktreeCard.cardId;
    } else {
      label = c.cwd ? folderHint(c.cwd, roots) : `pid ${c.rootPid}`;
    }

    const verifyDeadline = watcherAlive && entry?.deadline ? entry.deadline : null;
    return {
      id: c.id,
      pgid: c.pgid,
      pid: c.rootPid,
      pids: c.pids,
      sharedGroup: c.sharedGroup,
      watcherPid: watcherAlive ? entry!.watcherPid ?? null : null,
      port,
      // Unreadable (another user's process) shows as "–", the row stays.
      memoryBytes: sizes.length ? sizes.reduce((a, b) => a + b, 0) : null,
      ageSec: c.ageSec,
      cwd: c.cwd,
      label,
      cardId,
      source: entry ? "registry" : "scan",
      // A live verify server closes itself at its deadline; no 12h badge.
      stale: !verifyDeadline && c.ageSec >= STALE_AFTER_SEC,
      verifyDeadline,
      scannedAt: new Date(now).toISOString(),
    };
  });
}

/** Strip the runner-only fields before the list goes to the renderer. */
export function toPublic(server: ScannedServer): OrphanServer {
  const { pids: _pids, sharedGroup: _shared, watcherPid: _watcher, ...rest } = server;
  return rest;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Close one scanned server. The caller has just re-scanned, so the target
 * still matches the signature and folder rule — a reused PID never gets here.
 */
export async function stopScannedServer(server: ScannedServer): Promise<boolean> {
  if (server.watcherPid) {
    // What `verify-server stop` does: the watcher stops the group and removes
    // the worktree, so it must stay the one doing it.
    try {
      process.kill(server.watcherPid, "SIGTERM");
    } catch {
      // Watcher just went; fall through to stopping the group directly.
    }
    for (let i = 0; i < 100; i++) {
      if (!server.pids.some(isAlive)) return true;
      await sleep(100);
    }
  }

  if (server.sharedGroup) {
    // The group holds more than this server (Ideafy, a terminal session):
    // stop these PIDs one by one, never the group.
    const results = await Promise.all(server.pids.map((pid) => stopProcess(pid)));
    return results.every(Boolean) || !server.pids.some(isAlive);
  }

  return (await stopProcessGroupById(server.pgid)) || !server.pids.some(isAlive);
}
