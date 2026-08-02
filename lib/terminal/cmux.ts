import { spawn } from "child_process";
import { resolve as resolvePath } from "path";
import { findBinary } from "@/lib/platform/base-provider";

/**
 * cmux is driven through its CLI, which talks to the running app over a Unix
 * socket rather than taking launch arguments like the other terminals. That
 * buys us something the others cannot do: instead of spawning a window per
 * run, Ideafy can drop a tab into the workspace the user already keeps open
 * for the project.
 */

export interface CmuxWorkspace {
  /** UUID. Preferred over `workspace:N` refs, which are only stable per run. */
  id: string;
  title: string | null;
  currentDirectory: string | null;
}

/** `projects.cmuxWorkspaceId` value meaning "always open a fresh workspace". */
export const CMUX_WORKSPACE_NEW = "new";

const PING_ATTEMPTS = 40;
const PING_INTERVAL_MS = 250;

interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a command to completion. Never rejects. */
function runCmd(file: string, args: string[]): Promise<CmdResult> {
  return new Promise((resolve) => {
    // CMUX_QUIET silences the CLI's one-time deprecation hints, which would
    // otherwise land in stderr and read like failures in the logs.
    const child = spawn(file, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CMUX_QUIET: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => resolve({ code: -1, stdout, stderr: err.message }));
    child.on("exit", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

export function findCmuxBinary(): string {
  // The CLI ships inside the app bundle. CMUX_BUNDLED_CLI_PATH is only set
  // when Ideafy itself was started from a cmux terminal, so the bundle path
  // is the reliable fallback before `which`.
  return findBinary("cmux", [
    process.env.CMUX_BUNDLED_CLI_PATH ?? "",
    "/Applications/cmux.app/Contents/Resources/bin/cmux",
  ].filter(Boolean));
}

/**
 * Start cmux if it isn't running, and raise it above Ideafy if it is —
 * `--focus` only selects a workspace *within* cmux, so without this the new
 * terminal would open behind the app the user just clicked in. The socket
 * does not answer until the app has finished launching, hence the ping loop.
 */
async function ensureRunning(bin: string, tag: string): Promise<boolean> {
  await runCmd("open", ["-a", "cmux.app"]);

  for (let i = 0; i < PING_ATTEMPTS; i++) {
    if ((await runCmd(bin, ["ping"])).code === 0) return true;
    await new Promise((r) => setTimeout(r, PING_INTERVAL_MS));
  }

  console.error(
    `[${tag}] cmux socket did not respond within ` +
    `${(PING_ATTEMPTS * PING_INTERVAL_MS) / 1000}s; is cmux able to start?`,
  );
  return false;
}

/**
 * The workspaces of the current window. Returns [] when cmux is not running —
 * callers that merely want to show a list should not boot the app.
 */
export async function listCmuxWorkspaces(): Promise<CmuxWorkspace[]> {
  let bin: string;
  try {
    bin = findCmuxBinary();
  } catch {
    return [];
  }

  const { code, stdout } = await runCmd(bin, [
    "workspace", "list", "--json", "--id-format", "uuids",
  ]);
  if (code !== 0) return [];

  try {
    const parsed = JSON.parse(stdout) as {
      workspaces?: Array<{ id?: string; title?: string | null; current_directory?: string | null }>;
    };
    return (parsed.workspaces ?? [])
      .filter((w): w is { id: string; title?: string | null; current_directory?: string | null } =>
        typeof w.id === "string")
      .map((w) => ({
        id: w.id,
        title: w.title ?? null,
        currentDirectory: w.current_directory ?? null,
      }));
  } catch {
    return [];
  }
}

/**
 * Which workspace this project's tabs belong in, or null to open a standalone
 * workspace. Exported separately from the launch path so the decision can be
 * reasoned about (and tested) without touching a running cmux.
 */
export function resolveCmuxWorkspaceId(
  workspaces: CmuxWorkspace[],
  projectFolder: string | null,
  preference: string | null,
): string | null {
  if (preference === CMUX_WORKSPACE_NEW) return null;

  if (preference) {
    const pinned = workspaces.find((w) => w.id === preference);
    if (pinned) return pinned.id;
    // The pinned workspace has been closed since it was chosen. Fall through
    // to folder matching rather than failing the launch.
  }

  if (!projectFolder) return null;

  const target = resolvePath(projectFolder);
  const matches = workspaces.filter(
    (w) => w.currentDirectory && resolvePath(w.currentDirectory) === target,
  );

  // Two workspaces sharing a directory is a real configuration, not a bug, and
  // picking one at random would drop the terminal somewhere the user is not
  // looking. A standalone workspace is the honest answer; the per-project
  // override exists to break exactly this tie.
  return matches.length === 1 ? matches[0].id : null;
}

export interface OpenCmuxOptions {
  /** Working directory for the terminal — the card's worktree, or the repo. */
  cwd: string;
  /** Generated script the terminal should run. */
  scriptPath: string;
  /** Sidebar label for the tab. Agents overwrite this once they start. */
  name: string;
  /** Project root, matched against workspace directories. */
  projectFolder: string | null;
  /** `projects.cmuxWorkspaceId`. */
  workspacePreference: string | null;
  /** Log prefix identifying the caller. */
  tag: string;
  /**
   * Called with the UUID of a workspace this run had to create, so the project
   * can remember it. Without this, a project whose folder matches nothing —
   * or matches ambiguously — would create another workspace on every run, and
   * each one makes the next match worse. Not called when the project asked for
   * a fresh workspace every time; that choice is the user's to keep.
   */
  onWorkspaceCreated?: (workspaceId: string) => void;
}

/**
 * `workspace create` reports `OK workspace:22` and ignores --id-format, but
 * refs are only stable for the current run. Trade the ref for the UUID that is
 * safe to persist.
 */
async function refToUuid(bin: string, ref: string): Promise<string | null> {
  const { code, stdout } = await runCmd(bin, ["workspace", "list", "--id-format", "both"]);
  if (code !== 0) return null;

  // "* workspace:17 C51B586B-...-83FFE0AB2D0B  aidev-Ideafy Public"
  for (const line of stdout.split("\n")) {
    const m = line.match(/\b(workspace:\d+)\s+([0-9A-Fa-f-]{36})\b/);
    if (m && m[1] === ref) return m[2];
  }
  return null;
}

/**
 * Add a tab to an existing workspace. Returns false only when the tab could
 * not be created at all, so the caller knows it still owes the user a
 * terminal — a later step failing leaves a usable (if empty) tab, and
 * launching a second one on top of it would be worse.
 */
async function openTabIn(bin: string, workspaceId: string, opts: OpenCmuxOptions): Promise<boolean> {
  const created = await runCmd(bin, [
    "new-surface",
    "--workspace", workspaceId,
    "--working-directory", opts.cwd,
    "--focus", "true",
  ]);

  // "OK surface:45 pane:18 workspace:18"
  const surfaceRef = created.stdout.match(/\b(surface:\d+)\b/)?.[1];
  if (created.code !== 0 || !surfaceRef) {
    console.error(
      `[${opts.tag}] cmux new-surface failed (${created.code}): ` +
      `${created.stderr.trim() || created.stdout.trim()}`,
    );
    return false;
  }

  // rename-tab needs BOTH --workspace and --surface; --surface alone reports
  // "Tab not found". Purely cosmetic, so failure here is not worth aborting.
  await runCmd(bin, ["rename-tab", "--workspace", workspaceId, "--surface", surfaceRef, opts.name]);

  // The new tab starts at an interactive shell prompt — `new-surface` does not
  // return until the shell is ready, so the script can be typed straight in.
  // "\n" is how the CLI spells Enter.
  const sent = await runCmd(bin, ["send", "--surface", surfaceRef, `${opts.scriptPath}\n`]);
  if (sent.code !== 0) {
    console.error(`[${opts.tag}] cmux send failed (${sent.code}): ${sent.stderr.trim()}`);
  }
  return true;
}

/** Open a terminal in cmux. Fire-and-forget; failures are logged, not thrown. */
export async function openCmuxTerminal(opts: OpenCmuxOptions): Promise<void> {
  const bin = findCmuxBinary();
  if (!(await ensureRunning(bin, opts.tag))) return;

  const workspaceId = resolveCmuxWorkspaceId(
    await listCmuxWorkspaces(),
    opts.projectFolder,
    opts.workspacePreference,
  );

  if (workspaceId && (await openTabIn(bin, workspaceId, opts))) return;

  // No workspace to join, or the tab could not be created — a standalone
  // workspace still gets the user their terminal. `--command` runs the script
  // directly, so this path needs no send.
  const { code, stdout, stderr } = await runCmd(bin, [
    "workspace", "create",
    "--name", opts.name,
    "--cwd", opts.cwd,
    "--command", opts.scriptPath,
    "--focus", "true",
  ]);
  if (code !== 0) {
    console.error(`[${opts.tag}] cmux workspace create failed (${code}): ${stderr.trim()}`);
    return;
  }

  // Pin it, so the next run joins this workspace instead of adding another one
  // beside it. Skipped when the project asked for a fresh workspace per run.
  if (!opts.onWorkspaceCreated || opts.workspacePreference === CMUX_WORKSPACE_NEW) return;

  const ref = stdout.match(/\b(workspace:\d+)\b/)?.[1];
  const uuid = ref ? await refToUuid(bin, ref) : null;
  if (uuid) opts.onWorkspaceCreated(uuid);
}
