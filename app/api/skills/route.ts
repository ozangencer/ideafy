import { NextResponse } from "next/server";
import { join } from "path";
import { homedir } from "os";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getActiveProvider } from "@/lib/platform/active";
import { listGlobalSkillItems } from "@/lib/skills/catalog";

// Expand ~ to home directory
function expandPath(path: string): string {
  if (path.startsWith("~")) {
    return join(homedir(), path.slice(1));
  }
  return path;
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
    const items = listGlobalSkillItems(skillsPath);
    const skills = items.map((item) => item.name);

    return NextResponse.json({ skills, items });
  } catch (error) {
    console.error("Failed to read skills:", error);
    return NextResponse.json({ skills: [], items: [] });
  }
}
