import { NextResponse } from "next/server";
import { join } from "path";
import { homedir } from "os";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getActiveProvider } from "@/lib/platform/active";
import { listGlobalAgentItems } from "@/lib/agents/catalog";

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
      return NextResponse.json({ agents: [], items: [] });
    }

    const provider = getActiveProvider();
    const configuredPath = setting?.value || provider.getDefaultAgentsPath();
    const agentsPath = expandPath(configuredPath);

    const items = listGlobalAgentItems(agentsPath);
    const agents = items.map((item) => item.name);

    return NextResponse.json({ agents, items });
  } catch (error) {
    console.error("Failed to read agents:", error);
    return NextResponse.json({ agents: [], items: [] });
  }
}
