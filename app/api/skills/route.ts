import { NextResponse } from "next/server";
import { readdirSync, statSync } from "fs";
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

    const entries = readdirSync(skillsPath);
    const skills = entries.filter((entry) => {
      // Filter out hidden files and non-directories
      if (entry.startsWith(".")) return false;
      const fullPath = join(skillsPath, entry);
      return statSync(fullPath).isDirectory();
    });

    // Sort alphabetically
    skills.sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ skills });
  } catch (error) {
    console.error("Failed to read skills:", error);
    return NextResponse.json({ skills: [] });
  }
}
