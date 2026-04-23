import { NextResponse } from "next/server";
import { join } from "path";
import { homedir } from "os";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getActiveProvider } from "@/lib/platform/active";
import { listGlobalAgentItems } from "@/lib/agents/catalog";
import {
  listEnabledPluginEntries,
  listPluginAgentItems,
} from "@/lib/platform/claude-provider/plugin-scanner";
import type { AgentListItem } from "@/lib/types";

function expandPath(path: string): string {
  if (path.startsWith("~")) {
    return join(homedir(), path.slice(1));
  }
  return path;
}

function mergeAgentItems(
  base: AgentListItem[],
  plugin: AgentListItem[]
): AgentListItem[] {
  const map = new Map<string, AgentListItem>();
  for (const item of base) map.set(item.name, item);
  for (const item of plugin) {
    if (!map.has(item.name)) map.set(item.name, item);
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function GET() {
  try {
    const setting = db
      .select()
      .from(settings)
      .where(eq(settings.key, "agents_path"))
      .get();

    if (setting !== undefined && setting.value === "") {
      return NextResponse.json({ agents: [], items: [] });
    }

    const provider = getActiveProvider();
    const configuredPath = setting?.value || provider.getDefaultAgentsPath();
    const agentsPath = expandPath(configuredPath);

    const baseItems = listGlobalAgentItems(agentsPath);

    let pluginItems: AgentListItem[] = [];
    if (provider.id === "claude") {
      const entries = listEnabledPluginEntries({ scope: "user" });
      pluginItems = listPluginAgentItems(entries, "global");
    }

    const items = mergeAgentItems(baseItems, pluginItems);
    const agents = items.map((item) => item.name);

    return NextResponse.json({ agents, items });
  } catch (error) {
    console.error("Failed to read agents:", error);
    return NextResponse.json({ agents: [], items: [] });
  }
}
