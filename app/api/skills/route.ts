import { NextResponse } from "next/server";
import { join } from "path";
import { homedir } from "os";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getActiveProvider } from "@/lib/platform/active";
import { listGlobalSkillItems } from "@/lib/skills/catalog";
import {
  listEnabledPluginEntries,
  listPluginSkillItems,
} from "@/lib/platform/claude-provider/plugin-scanner";
import type { SkillListItem } from "@/lib/types";

// Expand ~ to home directory
function expandPath(path: string): string {
  if (path.startsWith("~")) {
    return join(homedir(), path.slice(1));
  }
  return path;
}

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

export async function GET() {
  try {
    // Get skills path from settings
    const setting = db
      .select()
      .from(settings)
      .where(eq(settings.key, "skills_path"))
      .get();

    // Kullanıcı path'i boş bıraktıysa, skills gösterme
    if (setting !== undefined && setting.value === "") {
      return NextResponse.json({ skills: [] });
    }

    const provider = getActiveProvider();
    const configuredPath = setting?.value || provider.getDefaultSkillsPath();
    const skillsPath = expandPath(configuredPath);
    const baseItems = listGlobalSkillItems(skillsPath);

    let pluginItems: SkillListItem[] = [];
    if (provider.id === "claude") {
      const entries = listEnabledPluginEntries({ scope: "user" });
      pluginItems = listPluginSkillItems(entries, "global");
    }

    const items = mergeSkillItems(baseItems, pluginItems);
    const skills = items.map((item) => item.name);

    return NextResponse.json({ skills, items });
  } catch (error) {
    console.error("Failed to read skills:", error);
    return NextResponse.json({ skills: [], items: [] });
  }
}
