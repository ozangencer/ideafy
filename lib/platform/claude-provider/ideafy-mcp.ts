import * as fs from "fs";
import * as path from "path";
import type { Result } from "../types";

// Plugin model is canonical for Claude. Per-project mcpServers.ideafy entries
// would duplicate the plugin's MCP registration and cause tool-name collisions
// in Claude Code. We keep the API surface so the active-provider dispatch in
// app/api/projects/[id]/mcp/route.ts stays stable, but install/has are no-ops.
// remove still scrubs legacy entries left behind by older Ideafy versions.

export function installIdeafyMcp(_folderPath: string): Result {
  return { success: true };
}

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

export function hasIdeafyMcp(_folderPath: string): boolean {
  return false;
}
