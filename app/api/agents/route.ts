import { NextResponse } from "next/server";
import { readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getActiveProvider } from "@/lib/platform/active";

function expandPath(path: string): string {
  if (path.startsWith("~")) {
    return join(homedir(), path.slice(1));
  }
  return path;
}

export async function GET() {
  try {
    const setting = db
      .select()
      .from(settings)
      .where(eq(settings.key, "agents_path"))
      .get();

    if (setting !== undefined && setting.value === "") {
      return NextResponse.json({ agents: [] });
    }

    const provider = getActiveProvider();
    const configuredPath = setting?.value || provider.getDefaultAgentsPath();
    const agentsPath = expandPath(configuredPath);

    const entries = readdirSync(agentsPath);
    const agents = entries
      .filter((entry) => {
        if (entry.startsWith(".")) return false;
        const full = join(agentsPath, entry);
        if (!statSync(full).isFile()) return false;
        return entry.endsWith(".md") || entry.endsWith(".toml");
      })
      .map((entry) => entry.replace(/\.(md|toml)$/, ""))
      .sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ agents });
  } catch (error) {
    console.error("Failed to read agents:", error);
    return NextResponse.json({ agents: [] });
  }
}
