import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getActiveProvider } from "@/lib/platform/active";
import { listProjectAgentItems } from "@/lib/agents/catalog";
import {
  listEnabledPluginEntries,
  listPluginAgentItems,
} from "@/lib/platform/claude-provider/plugin-scanner";
import type { AgentListItem } from "@/lib/types";

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .get();

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (!project.folderPath) {
      return NextResponse.json({ agents: [], items: [] });
    }

    const provider = getActiveProvider();
    const baseItems = listProjectAgentItems(project.folderPath, provider.id);

    let pluginItems: AgentListItem[] = [];
    if (provider.id === "claude") {
      const entries = listEnabledPluginEntries({
        scope: "project",
        projectPath: project.folderPath,
      });
      pluginItems = listPluginAgentItems(entries, "project");
    }

    const items = mergeAgentItems(baseItems, pluginItems);
    const agents = items.map((item) => item.name);
    return NextResponse.json({ agents, items });
  } catch (error) {
    console.error("Failed to list project agents:", error);
    return NextResponse.json({ agents: [], items: [] });
  }
}
