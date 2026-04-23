import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import type { Result } from "../types";

const MARKETPLACE_NAME = "ideafy";
const PLUGIN_NAME = "ideafy";
const PLUGIN_KEY = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
const DEFAULT_GITHUB_REPO = "ozangencer/ideafy-claude-plugin";
const DEFAULT_GIT_URL = `https://github.com/${DEFAULT_GITHUB_REPO}.git`;

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
    const proc = spawn(cmd, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", (err) => reject(new Error(`spawn ${cmd}: ${err.message}`)));
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

export async function getPluginStatus(): Promise<PluginStatus> {
  const installed = readJsonSafe<{ plugins?: Record<string, Array<{ version?: string; installPath?: string }>> }>(
    INSTALLED_FILE,
    {},
  );
  const settings = readJsonSafe<{ enabledPlugins?: Record<string, boolean> }>(SETTINGS_FILE, {});
  const marketplaces = readJsonSafe<Record<string, unknown>>(MARKETPLACES_FILE, {});

  const entries = installed.plugins?.[PLUGIN_KEY];
  const entry = entries && entries.length > 0 ? entries[0] : null;

  return {
    installed: !!entry,
    enabled: settings.enabledPlugins?.[PLUGIN_KEY] === true,
    version: entry?.version ?? null,
    installPath: entry?.installPath ?? null,
    marketplaceRegistered: MARKETPLACE_NAME in marketplaces,
  };
}

export async function installPlugin(options: { gitUrl?: string; localSource?: string } = {}): Promise<Result> {
  try {
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
    }

    const marketplaces = readJsonSafe<Record<string, unknown>>(MARKETPLACES_FILE, {});
    marketplaces[MARKETPLACE_NAME] = {
      source: { source: "github", repo: DEFAULT_GITHUB_REPO },
      installLocation: MARKETPLACE_DIR,
      lastUpdated: new Date().toISOString(),
    };
    writeJsonAtomic(MARKETPLACES_FILE, marketplaces);

    const installed = readJsonSafe<{ version?: number; plugins?: Record<string, unknown> }>(
      INSTALLED_FILE,
      { version: 2, plugins: {} },
    );
    if (typeof installed.version !== "number") installed.version = 2;
    if (!installed.plugins) installed.plugins = {};
    const now = new Date().toISOString();
    installed.plugins[PLUGIN_KEY] = [
      {
        scope: "user",
        installPath: cacheDir,
        version,
        installedAt: now,
        lastUpdated: now,
      },
    ];
    writeJsonAtomic(INSTALLED_FILE, installed);

    const settings = readJsonSafe<Record<string, unknown>>(SETTINGS_FILE, {});
    const enabled = (settings.enabledPlugins as Record<string, boolean>) ?? {};
    enabled[PLUGIN_KEY] = true;
    settings.enabledPlugins = enabled;
    writeJsonAtomic(SETTINGS_FILE, settings);

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function uninstallPlugin(options: { removeCache?: boolean } = {}): Promise<Result> {
  try {
    const settings = readJsonSafe<Record<string, unknown>>(SETTINGS_FILE, {});
    const enabled = (settings.enabledPlugins as Record<string, boolean>) ?? {};
    if (PLUGIN_KEY in enabled) {
      delete enabled[PLUGIN_KEY];
      if (Object.keys(enabled).length === 0) delete settings.enabledPlugins;
      else settings.enabledPlugins = enabled;
      writeJsonAtomic(SETTINGS_FILE, settings);
    }

    const installed = readJsonSafe<{ version?: number; plugins?: Record<string, unknown> }>(
      INSTALLED_FILE,
      { version: 2, plugins: {} },
    );
    if (installed.plugins && PLUGIN_KEY in installed.plugins) {
      delete installed.plugins[PLUGIN_KEY];
      writeJsonAtomic(INSTALLED_FILE, installed);
    }

    if (options.removeCache !== false) {
      fs.rmSync(CACHE_ROOT, { recursive: true, force: true });
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function setPluginEnabled(enabled: boolean): Promise<Result> {
  try {
    const settings = readJsonSafe<Record<string, unknown>>(SETTINGS_FILE, {});
    const map = (settings.enabledPlugins as Record<string, boolean>) ?? {};
    if (enabled) map[PLUGIN_KEY] = true;
    else delete map[PLUGIN_KEY];
    if (Object.keys(map).length === 0) delete settings.enabledPlugins;
    else settings.enabledPlugins = map;
    writeJsonAtomic(SETTINGS_FILE, settings);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
