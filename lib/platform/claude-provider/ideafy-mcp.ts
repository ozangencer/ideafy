import * as fs from "fs";
import * as path from "path";
import type { Result } from "../types";
import { buildMcpInvocation } from "../mcp-invocation";

/**
 * Install the Ideafy MCP server entry into a project's `.claude/settings.json`,
 * creating the directory and/or file if needed. Merges non-destructively with
 * any existing `mcpServers` entries.
 */
export function installIdeafyMcp(folderPath: string): Result {
  try {
    const claudeDir = path.join(folderPath, ".claude");
    const settingsPath = path.join(claudeDir, "settings.json");

    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    let existingSettings: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        existingSettings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      } catch {
        existingSettings = {};
      }
    }

    const existingMcpServers =
      (existingSettings.mcpServers as Record<string, unknown>) || {};
    if (existingMcpServers.ideafy) return { success: true };

    const mergedSettings = {
      ...existingSettings,
      mcpServers: {
        ...existingMcpServers,
        ideafy: buildMcpInvocation(),
      },
    };

    fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2));
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Remove the Ideafy MCP server entry from a project's `.claude/settings.json`.
 * If the `mcpServers` block becomes empty after removal it is dropped as well,
 * and the settings file is left as `{}` (but not deleted) so user-owned keys
 * persist across reinstalls.
 */
export function removeIdeafyMcp(folderPath: string): Result {
  try {
    const settingsPath = path.join(folderPath, ".claude", "settings.json");
    if (!fs.existsSync(settingsPath)) return { success: true };

    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    if (!settings.mcpServers?.ideafy) return { success: true };

    delete settings.mcpServers.ideafy;
    if (Object.keys(settings.mcpServers).length === 0) delete settings.mcpServers;

    fs.writeFileSync(
      settingsPath,
      Object.keys(settings).length === 0
        ? JSON.stringify({}, null, 2)
        : JSON.stringify(settings, null, 2),
    );
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/** True iff the project declares an `ideafy` MCP server. */
export function hasIdeafyMcp(folderPath: string): boolean {
  try {
    const settingsPath = path.join(folderPath, ".claude", "settings.json");
    if (!fs.existsSync(settingsPath)) return false;
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    return !!settings.mcpServers?.ideafy;
  } catch {
    return false;
  }
}
