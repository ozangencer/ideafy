import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getActiveProvider } from "@/lib/platform/active";
import {
  listEnabledPluginEntries,
  listPluginMcps,
} from "@/lib/platform/claude-provider/plugin-scanner";

// Expand ~ to home directory
function expandPath(path: string): string {
  if (path.startsWith("~")) {
    return join(homedir(), path.slice(1));
  }
  return path;
}

// Parse MCP server names from TOML content (Codex format)
function parseMcpNamesFromToml(content: string): string[] {
  const matches = content.matchAll(/\[mcp_servers\.(\w+)\]/g);
  return Array.from(matches, (m) => m[1]);
}

function readBaseMcps(configPath: string, format: "json" | "toml"): string[] {
  try {
    if (!existsSync(configPath)) return [];
    const configContent = readFileSync(configPath, "utf-8");
    if (format === "toml") {
      return parseMcpNamesFromToml(configContent);
    }
    const config = JSON.parse(configContent);
    return Object.keys(config.mcpServers || config.mcp || {});
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    // Get MCP config path from settings
    const setting = db
      .select()
      .from(settings)
      .where(eq(settings.key, "mcp_config_path"))
      .get();

    // Kullanıcı path'i boş bıraktıysa, MCPs gösterme
    if (setting !== undefined && setting.value === "") {
      return NextResponse.json({ mcps: [] });
    }

    const provider = getActiveProvider();
    const configuredPath = setting?.value || provider.getDefaultMcpConfigPath();
    const mcpConfigPath = expandPath(configuredPath);

    const baseMcps = readBaseMcps(
      mcpConfigPath,
      provider.capabilities.mcpConfigFormat === "toml" ? "toml" : "json"
    );

    const mcpSet = new Set<string>(baseMcps);
    if (provider.id === "claude") {
      const entries = listEnabledPluginEntries({ scope: "user" });
      for (const item of listPluginMcps(entries)) {
        mcpSet.add(item.name);
      }
    }

    const mcps = Array.from(mcpSet).sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ mcps });
  } catch (error) {
    console.error("Failed to read MCPs:", error);
    return NextResponse.json({ mcps: [] });
  }
}
