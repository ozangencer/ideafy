import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import type { Result } from "../types";
import { findBinary, buildEnv, isMissingDependencyError } from "../base-provider";

let cachedNpmPath: string | null = null;
let cachedGitPath: string | null = null;

function resolveNpm(): string {
  if (cachedNpmPath) return cachedNpmPath;
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const candidates = [
    "/opt/homebrew/bin/npm",
    "/usr/local/bin/npm",
    path.join(home, ".volta", "bin", "npm"),
    path.join(home, ".nvm", "versions", "node", "current", "bin", "npm"),
    "/usr/bin/npm",
  ];
  cachedNpmPath = findBinary("npm", candidates);
  return cachedNpmPath;
}

function resolveGit(): string {
  if (cachedGitPath) return cachedGitPath;
  const candidates = [
    "/usr/bin/git",
    "/opt/homebrew/bin/git",
    "/usr/local/bin/git",
  ];
  cachedGitPath = findBinary("git", candidates);
  return cachedGitPath;
}

function resolveCmd(cmd: string): string {
  if (cmd === "npm") return resolveNpm();
  if (cmd === "git") return resolveGit();
  return cmd;
}

const MARKETPLACE_NAME = "ideafy";
const PLUGIN_NAME = "ideafy";
const PLUGIN_KEY = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
const DEFAULT_GITHUB_REPO = "ozangencer/ideafy-claude-plugin";
const DEFAULT_GIT_URL = `https://github.com/${DEFAULT_GITHUB_REPO}.git`;
const DEFAULT_PLUGIN_JSON_URL = `https://raw.githubusercontent.com/${DEFAULT_GITHUB_REPO}/main/plugins/${PLUGIN_NAME}/.claude-plugin/plugin.json`;

/**
 * Oldest plugin release this build of Ideafy can safely talk to.
 *
 * The plugin ships its own MCP server that opens the same SQLite file the app
 * migrates on startup, so an app that has moved the schema forward can leave an
 * older plugin reading columns that no longer mean what it thinks. That is the
 * only thing this floor guards against.
 *
 * It is NOT a mirror of the app version: the plugin is on its own release cycle
 * (see .claude/skills/ideafy-build/scripts/bump-all-versions.mjs) and routinely
 * runs ahead of the app. Raise this ONLY when a schema or MCP contract change
 * genuinely breaks older plugins — every bump nags every user.
 */
export const MIN_PLUGIN_VERSION = "0.1.5";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const PLUGINS_DIR = path.join(CLAUDE_DIR, "plugins");
const MARKETPLACES_FILE = path.join(PLUGINS_DIR, "known_marketplaces.json");
const INSTALLED_FILE = path.join(PLUGINS_DIR, "installed_plugins.json");
const SETTINGS_FILE = path.join(CLAUDE_DIR, "settings.json");
const MARKETPLACE_DIR = path.join(PLUGINS_DIR, "marketplaces", MARKETPLACE_NAME);
const CACHE_ROOT = path.join(PLUGINS_DIR, "cache", MARKETPLACE_NAME, PLUGIN_NAME);

export interface PluginStatus {
  installed: boolean;
  enabled: boolean;
  version: string | null;
  installPath: string | null;
  marketplaceRegistered: boolean;
}

export type PluginScope = "user" | "project";

export interface ScopeOptions {
  scope?: PluginScope;
  projectPath?: string;
}

// A project-scope settings file is written under <projectPath>/.claude/. Only
// accept an absolute path with no `..` traversal segments so a caller-supplied
// projectPath cannot steer the write/read outside a real project directory.
// (The API route additionally checks the path against the registered project
// list; this is the by-construction fallback for any other caller.)
function isSafeProjectPath(projectPath: string): boolean {
  if (typeof projectPath !== "string" || projectPath.length === 0) return false;
  if (projectPath.includes("\0")) return false;
  if (!path.isAbsolute(projectPath)) return false;
  return !projectPath.split(/[\\/]+/).includes("..");
}

function resolveSettingsFile(opts: ScopeOptions): string {
  if (opts.scope === "project" && opts.projectPath) {
    if (!isSafeProjectPath(opts.projectPath)) {
      throw new Error(
        "Invalid projectPath: must be an absolute path with no '..' segments",
      );
    }
    return path.join(opts.projectPath, ".claude", "settings.json");
  }
  return SETTINGS_FILE;
}

function matchesScope(
  entry: { scope?: string; projectPath?: string } | undefined | null,
  opts: ScopeOptions,
): boolean {
  if (!entry) return false;
  const scope = opts.scope ?? "user";
  if (entry.scope !== scope) return false;
  if (scope === "project") return entry.projectPath === opts.projectPath;
  return true;
}

function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, filePath);
}

function exec(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    let resolved: string;
    try {
      resolved = resolveCmd(cmd);
    } catch (err) {
      // MissingDependencyError already has a clean, user-facing message —
      // forward it untouched so toasts don't show "spawn npm: Node.js…"
      if (isMissingDependencyError(err)) {
        reject(err);
      } else {
        reject(new Error(`Failed to launch ${cmd}: ${err instanceof Error ? err.message : String(err)}`));
      }
      return;
    }
    const proc = spawn(resolved, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: buildEnv(),
    });
    let stderr = "";
    proc.stderr?.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", (err) => reject(new Error(`Failed to launch ${cmd}: ${err.message}`)));
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          proc.kill("SIGKILL");
          reject(new Error(`${cmd} timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;
    proc.on("exit", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with ${code}: ${stderr.trim().slice(0, 500)}`));
    });
  });
}

// After `npm ci` some environments silently skip native compilation for
// better-sqlite3 (prebuilt download failure, missing node-gyp toolchain, etc.)
// leaving the MCP server unable to start. Verify the .node binary exists;
// if not, force a rebuild and fail loudly if that also fails.
async function ensureBetterSqlite3Binary(cacheDir: string): Promise<void> {
  const pkgDir = path.join(cacheDir, "node_modules", "better-sqlite3");
  if (!fs.existsSync(pkgDir)) return;
  const binary = path.join(pkgDir, "build", "Release", "better_sqlite3.node");
  if (fs.existsSync(binary)) return;
  await exec("npm", ["rebuild", "better-sqlite3"], {
    cwd: cacheDir,
    timeoutMs: 300_000,
  });
  if (!fs.existsSync(binary)) {
    throw new Error(
      `better-sqlite3 native binary missing after rebuild (${binary}); plugin MCP server will not start`,
    );
  }
}

// Accept only a plain https:// URL for `git clone`. Reject git transport
// helpers (ext::, fd:: — the `::` form makes git run arbitrary programs),
// alternate schemes (file:/ssh:/git:, all excluded by the https:// prefix),
// and any leading-dash value git would parse as an option. Applied before the
// clone so a caller-supplied gitUrl can never reach a git transport.
function isSafeGitUrl(url: string): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  if (url[0] === "-") return false;
  if (url.includes("::")) return false;
  return /^https:\/\//.test(url);
}

async function cloneOrUpdateMarketplace(gitUrl: string): Promise<void> {
  if (fs.existsSync(path.join(MARKETPLACE_DIR, ".git"))) {
    await exec("git", ["fetch", "--depth=1", "origin", "HEAD"], {
      cwd: MARKETPLACE_DIR,
      timeoutMs: 60_000,
    });
    await exec("git", ["reset", "--hard", "FETCH_HEAD"], {
      cwd: MARKETPLACE_DIR,
      timeoutMs: 15_000,
    });
  } else {
    fs.mkdirSync(path.dirname(MARKETPLACE_DIR), { recursive: true });
    await exec("git", ["clone", "--depth=1", gitUrl, MARKETPLACE_DIR], {
      timeoutMs: 120_000,
    });
  }
}

function copyTree(src: string, dest: string, skip: Set<string>): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(s, d, skip);
    else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(s), d);
    else fs.copyFileSync(s, d);
  }
}

export async function getPluginStatus(opts: ScopeOptions = {}): Promise<PluginStatus> {
  const installed = readJsonSafe<{
    plugins?: Record<string, Array<{ version?: string; installPath?: string; scope?: string; projectPath?: string }>>;
  }>(INSTALLED_FILE, {});
  const settingsFile = resolveSettingsFile(opts);
  const settings = readJsonSafe<{ enabledPlugins?: Record<string, boolean> }>(settingsFile, {});
  const marketplaces = readJsonSafe<Record<string, unknown>>(MARKETPLACES_FILE, {});

  const entries = installed.plugins?.[PLUGIN_KEY] ?? [];
  const entry = entries.find((e) => matchesScope(e, opts)) ?? null;

  return {
    installed: !!entry,
    enabled: settings.enabledPlugins?.[PLUGIN_KEY] === true,
    version: entry?.version ?? entries[0]?.version ?? null,
    installPath: entry?.installPath ?? entries[0]?.installPath ?? null,
    marketplaceRegistered: MARKETPLACE_NAME in marketplaces,
  };
}

export async function installPlugin(
  options: { gitUrl?: string; localSource?: string } & ScopeOptions = {},
): Promise<Result> {
  try {
    const scope: PluginScope = options.scope ?? "user";
    if (scope === "project" && !options.projectPath) {
      return { success: false, error: "projectPath is required when scope is 'project'" };
    }
    if (scope === "project" && !isSafeProjectPath(options.projectPath as string)) {
      return { success: false, error: "Invalid projectPath: must be an absolute path with no '..' segments" };
    }

    if (options.localSource) {
      if (!fs.existsSync(options.localSource)) {
        return { success: false, error: `Local source not found: ${options.localSource}` };
      }
      fs.rmSync(MARKETPLACE_DIR, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(MARKETPLACE_DIR), { recursive: true });
      copyTree(options.localSource, MARKETPLACE_DIR, new Set([".git", "node_modules"]));
    } else {
      const gitUrl = options.gitUrl ?? DEFAULT_GIT_URL;
      if (!isSafeGitUrl(gitUrl)) {
        return { success: false, error: `Refusing to clone from an untrusted git URL: ${gitUrl}` };
      }
      await cloneOrUpdateMarketplace(gitUrl);
    }

    const marketplaceManifest = readJsonSafe<{
      plugins?: Array<{ name: string; source: string; version?: string }>;
    }>(path.join(MARKETPLACE_DIR, ".claude-plugin", "marketplace.json"), {});
    const pluginEntry = marketplaceManifest.plugins?.find((p) => p.name === PLUGIN_NAME);
    if (!pluginEntry) {
      return { success: false, error: `Plugin '${PLUGIN_NAME}' not declared in marketplace.json` };
    }

    const pluginSrc = path.resolve(MARKETPLACE_DIR, pluginEntry.source);
    const pluginManifest = readJsonSafe<{ version?: string }>(
      path.join(pluginSrc, ".claude-plugin", "plugin.json"),
      {},
    );
    const version = pluginManifest.version ?? pluginEntry.version ?? "0.0.0";
    const cacheDir = path.join(CACHE_ROOT, version);

    fs.rmSync(cacheDir, { recursive: true, force: true });
    copyTree(pluginSrc, cacheDir, new Set([".git", "node_modules"]));

    if (fs.existsSync(path.join(cacheDir, "package.json"))) {
      // --ignore-scripts: never run the cloned tree's package.json lifecycle
      // scripts (pre/post/install). The one native dependency the MCP server
      // needs, better-sqlite3, is (re)built below via `npm rebuild` of that
      // single trusted package — the only script execution we allow.
      await exec("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts"], {
        cwd: cacheDir,
        timeoutMs: 300_000,
      });
      await ensureBetterSqlite3Binary(cacheDir);
    }

    const marketplaces = readJsonSafe<Record<string, unknown>>(MARKETPLACES_FILE, {});
    marketplaces[MARKETPLACE_NAME] = {
      source: { source: "github", repo: DEFAULT_GITHUB_REPO },
      installLocation: MARKETPLACE_DIR,
      lastUpdated: new Date().toISOString(),
    };
    writeJsonAtomic(MARKETPLACES_FILE, marketplaces);

    const installed = readJsonSafe<{
      version?: number;
      plugins?: Record<string, Array<Record<string, unknown>>>;
    }>(INSTALLED_FILE, { version: 2, plugins: {} });
    if (typeof installed.version !== "number") installed.version = 2;
    if (!installed.plugins) installed.plugins = {};
    const now = new Date().toISOString();
    const existingEntries = installed.plugins[PLUGIN_KEY] ?? [];
    const filtered = existingEntries.filter((e) => !matchesScope(e as { scope?: string; projectPath?: string }, { scope, projectPath: options.projectPath }));
    const newEntry: Record<string, unknown> = {
      scope,
      installPath: cacheDir,
      version,
      installedAt: now,
      lastUpdated: now,
    };
    if (scope === "project") newEntry.projectPath = options.projectPath;
    installed.plugins[PLUGIN_KEY] = [...filtered, newEntry];
    writeJsonAtomic(INSTALLED_FILE, installed);

    const settingsFile = resolveSettingsFile({ scope, projectPath: options.projectPath });
    const settings = readJsonSafe<Record<string, unknown>>(settingsFile, {});
    const enabled = (settings.enabledPlugins as Record<string, boolean>) ?? {};
    enabled[PLUGIN_KEY] = true;
    settings.enabledPlugins = enabled;
    writeJsonAtomic(settingsFile, settings);

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function uninstallPlugin(
  options: { removeCache?: boolean } & ScopeOptions = {},
): Promise<Result> {
  try {
    const scope: PluginScope = options.scope ?? "user";
    if (scope === "project" && !options.projectPath) {
      return { success: false, error: "projectPath is required when scope is 'project'" };
    }

    const settingsFile = resolveSettingsFile({ scope, projectPath: options.projectPath });
    const settings = readJsonSafe<Record<string, unknown>>(settingsFile, {});
    const enabledMap = (settings.enabledPlugins as Record<string, boolean>) ?? {};
    if (PLUGIN_KEY in enabledMap) {
      delete enabledMap[PLUGIN_KEY];
      if (Object.keys(enabledMap).length === 0) delete settings.enabledPlugins;
      else settings.enabledPlugins = enabledMap;
      if (Object.keys(settings).length === 0) {
        if (fs.existsSync(settingsFile)) writeJsonAtomic(settingsFile, {});
      } else {
        writeJsonAtomic(settingsFile, settings);
      }
    }

    const installed = readJsonSafe<{
      version?: number;
      plugins?: Record<string, Array<Record<string, unknown>>>;
    }>(INSTALLED_FILE, { version: 2, plugins: {} });
    const existing = installed.plugins?.[PLUGIN_KEY] ?? [];
    const remaining = existing.filter(
      (e) => !matchesScope(e as { scope?: string; projectPath?: string }, { scope, projectPath: options.projectPath }),
    );
    if (remaining.length !== existing.length && installed.plugins) {
      if (remaining.length === 0) delete installed.plugins[PLUGIN_KEY];
      else installed.plugins[PLUGIN_KEY] = remaining;
      writeJsonAtomic(INSTALLED_FILE, installed);
    }

    const allEntriesGone = (installed.plugins?.[PLUGIN_KEY]?.length ?? 0) === 0;
    if (allEntriesGone && options.removeCache !== false) {
      fs.rmSync(CACHE_ROOT, { recursive: true, force: true });
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function setPluginEnabled(enabled: boolean, opts: ScopeOptions = {}): Promise<Result> {
  try {
    const scope: PluginScope = opts.scope ?? "user";
    if (scope === "project" && !opts.projectPath) {
      return { success: false, error: "projectPath is required when scope is 'project'" };
    }
    const settingsFile = resolveSettingsFile({ scope, projectPath: opts.projectPath });
    const settings = readJsonSafe<Record<string, unknown>>(settingsFile, {});
    const map = (settings.enabledPlugins as Record<string, boolean>) ?? {};
    if (enabled) map[PLUGIN_KEY] = true;
    else delete map[PLUGIN_KEY];
    if (Object.keys(map).length === 0) delete settings.enabledPlugins;
    else settings.enabledPlugins = map;
    writeJsonAtomic(settingsFile, settings);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface UpdateCheckResult {
  installed: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  hasUpdate: boolean;
  /** Floor this app build requires; echoed so the client can name it. */
  minimumVersion: string;
  /** Installed version is older than the floor — a hard compatibility warning. */
  belowMinimum: boolean;
  error?: string;
}

/**
 * Compares two dotted version strings numerically. Any pre-release suffix
 * ("0.2.0-beta.1") is dropped before comparing, so a pre-release counts as its
 * release version — deliberately lenient, since the alternative is warning a
 * tester who is deliberately ahead of the floor.
 * Returns <0, 0 or >0 in the manner of a sort comparator.
 */
function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** True when `version` is older than MIN_PLUGIN_VERSION. Unknown → not below. */
export function isBelowMinimum(version: string | null): boolean {
  if (!version) return false;
  return compareVersions(version, MIN_PLUGIN_VERSION) < 0;
}

/**
 * Checks the marketplace's plugin.json on GitHub for a newer version without
 * modifying anything locally. Uses raw.githubusercontent.com (no git clone,
 * no auth, ~500ms). Returns {hasUpdate: true} when the remote version string
 * differs from the installed entry's version for the given scope.
 */
export async function checkForUpdates(opts: ScopeOptions = {}): Promise<UpdateCheckResult> {
  const status = await getPluginStatus(opts);
  if (!status.installed) {
    return {
      installed: false,
      currentVersion: null,
      latestVersion: null,
      hasUpdate: false,
      minimumVersion: MIN_PLUGIN_VERSION,
      belowMinimum: false,
    };
  }
  const belowMinimum = isBelowMinimum(status.version);
  try {
    const response = await fetch(DEFAULT_PLUGIN_JSON_URL, {
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok) {
      return {
        installed: true,
        currentVersion: status.version,
        latestVersion: null,
        hasUpdate: false,
        minimumVersion: MIN_PLUGIN_VERSION,
        belowMinimum,
        error: `Failed to fetch remote manifest: HTTP ${response.status}`,
      };
    }
    const manifest = (await response.json()) as { version?: string };
    const latestVersion = manifest.version ?? null;
    return {
      installed: true,
      currentVersion: status.version,
      latestVersion,
      hasUpdate: !!latestVersion && latestVersion !== status.version,
      minimumVersion: MIN_PLUGIN_VERSION,
      belowMinimum,
    };
  } catch (error) {
    // The network leg failed, but belowMinimum came from the local install
    // record — still worth reporting, since that is the warning that matters.
    return {
      installed: true,
      currentVersion: status.version,
      latestVersion: null,
      hasUpdate: false,
      minimumVersion: MIN_PLUGIN_VERSION,
      belowMinimum,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
