import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getActiveProvider } from "@/lib/platform/active";
import { listProjectSkillItems } from "@/lib/skills/catalog";
import {
  listEnabledPluginEntries,
  listPluginSkillItems,
} from "@/lib/platform/claude-provider/plugin-scanner";
import type { SkillListItem } from "@/lib/types";

function mergeSkillItems(
  base: SkillListItem[],
  plugin: SkillListItem[]
): SkillListItem[] {
  const map = new Map<string, SkillListItem>();
  for (const item of base) map.set(item.name, item);
  for (const item of plugin) {
    if (!map.has(item.name)) map.set(item.name, item);
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// List skills in project's .claude/commands/
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
      return NextResponse.json({ skills: [], items: [] });
    }

    const provider = getActiveProvider();
    const baseItems = listProjectSkillItems(project.folderPath, provider.id);

    let pluginItems: SkillListItem[] = [];
    if (provider.id === "claude") {
      const entries = listEnabledPluginEntries({
        scope: "project",
        projectPath: project.folderPath,
      });
      pluginItems = listPluginSkillItems(entries, "project");
    }

    const items = mergeSkillItems(baseItems, pluginItems);
    const skills = items.map((item) => item.name);
    return NextResponse.json({ skills, items });
  } catch (error) {
    console.error("Failed to list project skills:", error);
    return NextResponse.json({ skills: [], items: [] });
  }
}
