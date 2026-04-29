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

function resolveSettingsFile(opts: ScopeOptions): string {
  if (opts.scope === "project" && opts.projectPath) {
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

    if (options.localSource) {
      if (!fs.existsSync(options.localSource)) {
        return { success: false, error: `Local source not found: ${options.localSource}` };
      }
      fs.rmSync(MARKETPLACE_DIR, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(MARKETPLACE_DIR), { recursive: true });
      copyTree(options.localSource, MARKETPLACE_DIR, new Set([".git", "node_modules"]));
    } else {
      await cloneOrUpdateMarketplace(options.gitUrl ?? DEFAULT_GIT_URL);
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
      await exec("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], {
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
  error?: string;
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
    };
  }
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
    };
  } catch (error) {
    return {
      installed: true,
      currentVersion: status.version,
      latestVersion: null,
      hasUpdate: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
