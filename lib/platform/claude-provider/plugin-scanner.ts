import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { AgentListItem, SkillListItem, SkillSource } from "@/lib/types";
import { parseSkillDocument } from "@/lib/skills/frontmatter";
import { parseSimpleFrontmatter, humanizeSkillName } from "@/lib/skills/frontmatter";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const PLUGINS_DIR = path.join(CLAUDE_DIR, "plugins");
const INSTALLED_FILE = path.join(PLUGINS_DIR, "installed_plugins.json");
const USER_SETTINGS_FILE = path.join(CLAUDE_DIR, "settings.json");

export interface PluginEntry {
  /** Plugin key, e.g. "ideafy@ideafy" */
  key: string;
  /** Plugin name (left of @), used as namespace prefix */
  name: string;
  /** Absolute path to the plugin's cache directory */
  installPath: string;
  scope: "user" | "project";
  version: string | null;
  projectPath?: string;
}

interface InstalledPluginsFile {
  version?: number;
  plugins?: Record<
    string,
    Array<{
      scope?: string;
      installPath?: string;
      version?: string;
      projectPath?: string;
    }>
  >;
}

interface SettingsFile {
  enabledPlugins?: Record<string, boolean>;
}

function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function pluginNameFromKey(key: string): string {
  const atIdx = key.indexOf("@");
  return atIdx > 0 ? key.slice(0, atIdx) : key;
}

/**
 * Lists enabled plugin entries.
 * - When called with no opts (or scope="user"), returns user-scope entries enabled via ~/.claude/settings.json.
 * - When called with scope="project" and a projectPath, returns project-scope entries for that project
 *   that are enabled via <projectPath>/.claude/settings.json.
 */
export function listEnabledPluginEntries(opts: {
  scope: "user" | "project";
  projectPath?: string;
}): PluginEntry[] {
  const installed = readJsonSafe<InstalledPluginsFile>(INSTALLED_FILE, {});
  const plugins = installed.plugins ?? {};

  const settingsFile =
    opts.scope === "project" && opts.projectPath
      ? path.join(opts.projectPath, ".claude", "settings.json")
      : USER_SETTINGS_FILE;
  const settings = readJsonSafe<SettingsFile>(settingsFile, {});
  const enabledMap = settings.enabledPlugins ?? {};

  const entries: PluginEntry[] = [];
  for (const [key, list] of Object.entries(plugins)) {
    if (enabledMap[key] !== true) continue;
    for (const entry of list ?? []) {
      if (!entry?.installPath) continue;
      const scope = entry.scope === "project" ? "project" : "user";
      if (scope !== opts.scope) continue;
      if (scope === "project") {
        if (!opts.projectPath || entry.projectPath !== opts.projectPath) continue;
      }
      entries.push({
        key,
        name: pluginNameFromKey(key),
        installPath: entry.installPath,
        scope,
        version: entry.version ?? null,
        projectPath: entry.projectPath,
      });
    }
  }
  return entries;
}

function safeReadDir(dir: string): fs.Dirent[] {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Scan one plugin's skills/ directory (directory-based SKILL.md layout). */
function scanPluginSkillDir(
  rootDir: string,
  entry: PluginEntry,
  source: SkillSource
): SkillListItem[] {
  const items: SkillListItem[] = [];
  for (const child of safeReadDir(rootDir)) {
    if (child.name.startsWith(".")) continue;
    if (!child.isDirectory()) continue;
    const skillFile = path.join(rootDir, child.name, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;
    try {
      const content = fs.readFileSync(skillFile, "utf-8");
      const meta = parseSkillDocument(content, child.name);
      const localName = child.name;
      items.push({
        name: `${entry.name}:${localName}`,
        title: meta.displayTitle,
        path: skillFile,
        group: meta.group,
        description: meta.description,
        source,
        pluginKey: entry.key,
      });
    } catch {
      /* ignore unreadable skill */
    }
  }
  return items;
}

/** Scan one plugin's commands/ directory (flat .md slash commands). */
function scanPluginCommandDir(
  rootDir: string,
  entry: PluginEntry,
  source: SkillSource
): SkillListItem[] {
  const items: SkillListItem[] = [];
  for (const child of safeReadDir(rootDir)) {
    if (child.name.startsWith(".")) continue;
    if (!child.isFile()) continue;
    if (!child.name.endsWith(".md")) continue;
    const filePath = path.join(rootDir, child.name);
    const localName = child.name.replace(/\.md$/i, "");
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const meta = parseSkillDocument(content, localName);
      items.push({
        name: `${entry.name}:${localName}`,
        title: meta.displayTitle,
        path: filePath,
        group: meta.group,
        description: meta.description,
        source,
        pluginKey: entry.key,
      });
    } catch {
      /* ignore unreadable command */
    }
  }
  return items;
}

export function listPluginSkillItems(
  entries: PluginEntry[],
  source: SkillSource
): SkillListItem[] {
  const items: SkillListItem[] = [];
  for (const entry of entries) {
    if (!fs.existsSync(entry.installPath)) continue;
    items.push(
      ...scanPluginSkillDir(path.join(entry.installPath, "skills"), entry, source)
    );
    items.push(
      ...scanPluginCommandDir(path.join(entry.installPath, "commands"), entry, source)
    );
  }
  return dedupeByName(items);
}

function dedupeByName<T extends { name: string }>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    if (!map.has(item.name)) map.set(item.name, item);
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

interface McpJsonFile {
  mcpServers?: Record<string, unknown>;
}

export interface PluginMcpItem {
  /** Namespaced name, e.g. "ideafy:ideafy" */
  name: string;
  /** Raw name inside the plugin's .mcp.json */
  localName: string;
  pluginKey: string;
}

export function listPluginMcps(entries: PluginEntry[]): PluginMcpItem[] {
  const items: PluginMcpItem[] = [];
  for (const entry of entries) {
    const mcpFile = path.join(entry.installPath, ".mcp.json");
    const parsed = readJsonSafe<McpJsonFile>(mcpFile, {});
    const servers = parsed.mcpServers ?? {};
    for (const localName of Object.keys(servers)) {
      items.push({
        name: `${entry.name}:${localName}`,
        localName,
        pluginKey: entry.key,
      });
    }
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

function parseTomlDescription(content: string): string | null {
  const match = content.match(/^\s*description\s*=\s*["']([\s\S]*?)["']\s*$/m);
  return match?.[1]?.trim() || null;
}

export function listPluginAgentItems(
  entries: PluginEntry[],
  source: SkillSource
): AgentListItem[] {
  const items: AgentListItem[] = [];
  for (const entry of entries) {
    const agentsDir = path.join(entry.installPath, "agents");
    for (const child of safeReadDir(agentsDir)) {
      if (child.name.startsWith(".")) continue;
      if (!child.isFile()) continue;
      const ext = path.extname(child.name).toLowerCase();
      if (ext !== ".md" && ext !== ".toml") continue;

      const format = ext === ".toml" ? "toml" : "md";
      const filePath = path.join(agentsDir, child.name);
      const localName = path.basename(child.name, ext);

      let title = humanizeSkillName(localName);
      let description: string | null = null;
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        if (format === "md") {
          const { frontmatter } = parseSimpleFrontmatter(content);
          title = frontmatter.title || frontmatter.name || title;
          description =
            frontmatter.description ||
            frontmatter.summary ||
            frontmatter.subtitle ||
            null;
        } else {
          description = parseTomlDescription(content);
        }
      } catch {
        continue;
      }

      items.push({
        name: `${entry.name}:${localName}`,
        title,
        path: filePath,
        description,
        source,
        format,
        pluginKey: entry.key,
      });
    }
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}
