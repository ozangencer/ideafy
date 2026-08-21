import { spawn } from "child_process";
import {
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "fs";
import { join, resolve as resolvePath } from "path";
import { tmpdir } from "os";
import { findBinary } from "@/lib/platform/base-provider";
import { resolveUserDataDir } from "@/lib/paths";

/**
 * cmux is driven through its CLI, which talks to the running app over a Unix
 * socket. That socket only answers processes cmux itself started — a request
 * from anywhere else is refused with "Access denied - only processes started
 * inside cmux can connect". Ideafy launched from the Dock is exactly that
 * "anywhere else", so it cannot drive cmux directly at all.
 *
 * The way in is LaunchServices: cmux registers as a handler for shell scripts,
 * so `open -a cmux.app <script>` makes cmux run it in a fresh tab — no socket
 * involved. cmux injects a socket capability into that tab's environment, so
 * from inside the script the whole CLI is available. Every run is therefore two
 * stages: Ideafy opens a bootstrap script, and the bootstrap — now speaking for
 * a process cmux started — places itself and execs the real command.
 *
 * Placement decisions stay here on the server (see resolveCmuxWorkspaceId); the
 * bootstrap posts the workspace list to /api/cmux/resolve and does what it is
 * told, so the interesting logic remains testable TypeScript rather than shell.
 */

export interface CmuxWorkspace {
  /** UUID. Preferred over `workspace:N` refs, which are only stable per run. */
  id: string;
  title: string | null;
  currentDirectory: string | null;
}

/** `projects.cmuxWorkspaceId` value meaning "always open a fresh workspace". */
export const CMUX_WORKSPACE_NEW = "new";

/** What the bootstrap should do with the workspace cmux just put it in. */
export type CmuxPlacement =
  /** Move into this existing workspace. */
  | { kind: "move"; workspaceId: string }
  /** Keep this one, name it after the project, and pin it to the project. */
  | { kind: "keep" }
  /** Keep it as-is: the project asked for a fresh workspace every run. */
  | { kind: "stay" };

const WORKSPACE_CACHE_FILE = "cmux-workspaces.json";

/**
 * How long a reported workspace list is worth showing. Ideafy cannot refresh
 * it on its own — the socket refuses us — so without an expiry the picker
 * would keep offering workspaces from a cmux that has since been quit, or
 * uninstalled, with nothing able to notice.
 */
const WORKSPACE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Filename stem of the bootstrap scripts. Shared by the writer and the filter. */
const BOOTSTRAP_NAME_PREFIX = "ideafy-cmux-";

interface CachedWorkspaces {
  /** Epoch ms the list was reported. Read back against WORKSPACE_CACHE_TTL_MS. */
  savedAt: number;
  workspaces: CmuxWorkspace[];
}

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

function workspaceCachePath(): string {
  return join(resolveUserDataDir(), WORKSPACE_CACHE_FILE);
}

/**
 * Remember the list a bootstrap reported. Ideafy's own process is refused by
 * the socket, so this cache is the only way the project settings picker can
 * offer real workspaces to choose from.
 */
export function cacheCmuxWorkspaces(workspaces: CmuxWorkspace[]): void {
  try {
    const snapshot: CachedWorkspaces = { savedAt: Date.now(), workspaces };
    writeFileSync(workspaceCachePath(), JSON.stringify(snapshot), { mode: 0o600 });
  } catch (err) {
    console.error(`[cmux] could not cache workspace list: ${(err as Error).message}`);
  }
}

function readCachedCmuxWorkspaces(): CmuxWorkspace[] {
  try {
    const path = workspaceCachePath();
    if (!existsSync(path)) return [];
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    // Older builds wrote a bare array. Nothing says how stale one of those is,
    // so treat it as expired; the next launch replaces it with a dated one.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const { savedAt, workspaces } = parsed as Partial<CachedWorkspaces>;
    if (typeof savedAt !== "number" || !Array.isArray(workspaces)) return [];
    if (Date.now() - savedAt > WORKSPACE_CACHE_TTL_MS) return [];
    return workspaces.filter((w): w is CmuxWorkspace =>
      !!w && typeof (w as CmuxWorkspace).id === "string");
  } catch {
    return [];
  }
}

/** Shape of `cmux workspace list --json`. Exported so the API route can parse it. */
export function parseCmuxWorkspaceList(json: string): CmuxWorkspace[] {
  try {
    const parsed = JSON.parse(json) as {
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
 * True for the workspace cmux opened only to run one of our bootstrap scripts.
 * It lives for a moment — the bootstrap renames it or moves out and closes it —
 * but the list is reported before either happens, so it has to be dropped here
 * or it lands in the cache and, from there, in the settings picker as a
 * workspace that no longer exists.
 *
 * `selfId` is the bootstrap naming itself and is authoritative. The title check
 * covers the case where cmux left no workspace id in its environment: cmux
 * titles the tab after the command it was handed, which is our script's path.
 */
export function isBootstrapWorkspace(
  workspace: CmuxWorkspace,
  selfId: string | null,
): boolean {
  if (selfId && workspace.id === selfId) return true;
  return !!workspace.title && workspace.title.includes(BOOTSTRAP_NAME_PREFIX);
}

/**
 * The workspaces cmux has open. Asks the CLI first — which only answers when
 * Ideafy itself was started from a cmux terminal — and otherwise falls back to
 * what the last launch reported. Returns [] when neither is available; callers
 * that merely want to show a list should not boot the app.
 */
export async function listCmuxWorkspaces(): Promise<CmuxWorkspace[]> {
  let bin: string;
  try {
    bin = findCmuxBinary();
  } catch {
    return readCachedCmuxWorkspaces();
  }

  const { code, stdout } = await runCmd(bin, [
    "workspace", "list", "--json", "--id-format", "uuids",
  ]);
  if (code !== 0) return readCachedCmuxWorkspaces();

  const workspaces = parseCmuxWorkspaceList(stdout);
  return workspaces.length > 0 ? workspaces : readCachedCmuxWorkspaces();
}

/**
 * Which workspace this project's tabs belong in. Exported separately from the
 * launch path so the decision can be reasoned about (and tested) without
 * touching a running cmux.
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
  // looking. Keeping the fresh one is the honest answer; the per-project
  // override exists to break exactly this tie.
  return matches.length === 1 ? matches[0].id : null;
}

/**
 * Turn a resolved workspace id into an instruction for the bootstrap. Pulled
 * out of the route so the "no match, so adopt and remember this one" rule sits
 * next to the matching rule it complements.
 */
export function decideCmuxPlacement(
  workspaces: CmuxWorkspace[],
  projectFolder: string | null,
  preference: string | null,
): CmuxPlacement {
  if (preference === CMUX_WORKSPACE_NEW) return { kind: "stay" };

  const workspaceId = resolveCmuxWorkspaceId(workspaces, projectFolder, preference);
  if (workspaceId) return { kind: "move", workspaceId };

  // Nothing to join. The workspace cmux just created for this run becomes the
  // project's — otherwise a folder that matches nothing (or matches
  // ambiguously) would collect another workspace on every single run.
  return { kind: "keep" };
}

export interface OpenCmuxOptions {
  /** Working directory for the terminal — the card's worktree, or the repo. */
  cwd: string;
  /** Generated script the terminal should run. */
  scriptPath: string;
  /** Sidebar label for the tab. Agents overwrite this once they start. */
  name: string;
  /** Project the run belongs to; lets the bootstrap ask where to place itself. */
  projectId: string | null;
  /** Project root, used for placement when there is no project row. */
  projectFolder: string | null;
  /** Log prefix identifying the caller. */
  tag: string;
}

// POSIX shell single-quote: safe for any string (no null byte).
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function ideafyBaseUrl(): string {
  return `http://127.0.0.1:${process.env.PORT || "3030"}`;
}

/**
 * The script cmux runs on our behalf. It is deliberately dumb: ask Ideafy where
 * this tab belongs, do that, then hand the terminal over to the real command.
 * Every cmux call here is allowed because cmux started this process.
 */
function buildBootstrap(opts: OpenCmuxOptions): string {
  const resolveUrl = new URL("/api/cmux/resolve", ideafyBaseUrl());
  if (opts.projectId) resolveUrl.searchParams.set("projectId", opts.projectId);
  if (opts.projectFolder) resolveUrl.searchParams.set("folder", opts.projectFolder);

  const pinUrl = opts.projectId
    ? new URL(`/api/projects/${encodeURIComponent(opts.projectId)}`, ideafyBaseUrl()).toString()
    : "";

  return `#!/bin/bash
# Generated by Ideafy. Opened through LaunchServices so cmux runs it, which is
# what earns this process the socket access the CLI calls below need.
CMUX="\${CMUX_BUNDLED_CLI_PATH:-/Applications/cmux.app/Contents/Resources/bin/cmux}"
export CMUX_QUIET=1
NAME=${shellQuote(opts.name)}
RUN=${shellQuote(opts.scriptPath)}

place() {
  [ -x "$CMUX" ] || return 0
  [ -n "$CMUX_SURFACE_ID" ] || return 0

  local list target workspace self_title
  list=$("$CMUX" workspace list --json --id-format uuids 2>/dev/null) || return 0
  # Plain-text reply: a workspace UUID, "keep", or "stay". Keeps the parsing
  # here to a case statement instead of a JSON reader the shell may not have.
  # x-cmux-self-workspace lets the server drop this throwaway workspace from
  # the list before caching it. A header rather than a query param: the URL
  # already carries conditional params, and computing "?" vs "&" in shell is
  # the kind of thing that breaks quietly.
  target=$(printf '%s' "$list" | curl -sS -m 10 -X POST ${shellQuote(resolveUrl.toString())} \\
    -H 'content-type: application/json' \\
    -H "x-cmux-self-workspace: $CMUX_WORKSPACE_ID" --data-binary @- 2>/dev/null)

  workspace="$CMUX_WORKSPACE_ID"
  case "$target" in
    keep)
      "$CMUX" workspace rename "$CMUX_WORKSPACE_ID" --title "$NAME" >/dev/null 2>&1
      ${pinUrl
        ? `curl -sS -m 10 -X PUT ${shellQuote(pinUrl)} -H 'content-type: application/json' \\
        -d "{\\"cmuxWorkspaceId\\":\\"$CMUX_WORKSPACE_ID\\"}" >/dev/null 2>&1`
        : ": # no project row to pin the workspace to"}
      ;;
    stay|"")
      ;;
    *)
      if "$CMUX" move-surface --surface "$CMUX_SURFACE_ID" --workspace "$target" \\
          --focus true >/dev/null 2>&1; then
        workspace="$target"
        # Moving out does not clean up behind us, so the workspace cmux made to
        # hold this script would linger empty after every run. Close it only
        # when its title still carries this bootstrap's filename — proof it is
        # ours. Anything else (a title we do not recognise, a listing we could
        # not read) leaves an empty workspace rather than risking a workspace
        # with the user's tabs in it.
        self_title=$("$CMUX" workspace list --id-format uuids 2>/dev/null | grep -F "$CMUX_WORKSPACE_ID")
        case "$self_title" in
          *"$(basename "$0")"*)
            "$CMUX" workspace close "$CMUX_WORKSPACE_ID" >/dev/null 2>&1
            ;;
        esac
      fi
      ;;
  esac

  # rename-tab needs BOTH --workspace and --surface, and after a move the
  # workspace in our environment is the one we left, so pass it explicitly.
  "$CMUX" rename-tab --workspace "$workspace" --surface "$CMUX_SURFACE_ID" "$NAME" >/dev/null 2>&1
}

place
exec "$RUN"
`;
}

/** Bootstraps older than this are from runs that are long over. */
const BOOTSTRAP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Delete the bootstrap scripts earlier launches left in tmp — cmux runs them
 * and nobody cleans up after. A day old is well past any live launch, which
 * keeps the sweep away from a script bash has not finished reading. Best
 * effort throughout: a failed sweep must never stop a terminal from opening.
 */
function sweepOldBootstraps(): void {
  try {
    const dir = tmpdir();
    const cutoff = Date.now() - BOOTSTRAP_MAX_AGE_MS;
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(BOOTSTRAP_NAME_PREFIX) || !name.endsWith(".sh")) continue;
      const path = join(dir, name);
      try {
        if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
      } catch {
        // Already gone, or not ours to remove. Either way there is nothing to do.
      }
    }
  } catch (err) {
    console.error(`[cmux] could not sweep old bootstraps: ${(err as Error).message}`);
  }
}

/**
 * Open a terminal in cmux. Fire-and-forget; failures are logged, not thrown.
 * Resolves once the bootstrap has been handed to LaunchServices — everything
 * after that happens inside cmux.
 */
export async function openCmuxTerminal(opts: OpenCmuxOptions): Promise<void> {
  sweepOldBootstraps();

  const bootstrapPath = join(
    tmpdir(),
    `${BOOTSTRAP_NAME_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sh`,
  );
  // 0o700 — same reasoning as the script it wraps: only the current user may
  // read or run it.
  writeFileSync(bootstrapPath, buildBootstrap(opts), { mode: 0o700 });

  // `open` launches cmux if it is not running and raises it if it is, then
  // hands over the script as a document. No socket, so no permission to earn.
  const { code, stderr } = await runCmd("open", ["-a", "cmux.app", bootstrapPath]);
  if (code !== 0) {
    console.error(
      `[${opts.tag}] could not open cmux (${code}): ${stderr.trim() || "no output"}`,
    );
  }
}
