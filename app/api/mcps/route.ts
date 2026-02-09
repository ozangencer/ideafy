import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getActiveProvider } from "@/lib/platform/active";

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

    const configContent = readFileSync(mcpConfigPath, "utf-8");

    let mcps: string[];
    if (provider.capabilities.mcpConfigFormat === "toml") {
      mcps = parseMcpNamesFromToml(configContent);
    } else {
      const config = JSON.parse(configContent);
      mcps = Object.keys(config.mcpServers || {});
    }

    // Sort alphabetically
    mcps.sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ mcps });
  } catch (error) {
    console.error("Failed to read MCPs:", error);
    return NextResponse.json({ mcps: [] });
  }
}
