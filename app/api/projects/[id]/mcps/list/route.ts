import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { listProjectMcps } from "@/lib/mcp-skills-installer";
import { getActiveProvider } from "@/lib/platform/active";
import {
  listEnabledPluginEntries,
  listPluginMcps,
} from "@/lib/platform/claude-provider/plugin-scanner";

// List MCPs in project's .claude/settings.json (+ project-scope plugin MCPs)
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
      return NextResponse.json({ mcps: [] });
    }

    const baseMcps = listProjectMcps(project.folderPath);
    const mcpSet = new Set<string>(baseMcps);

    if (getActiveProvider().id === "claude") {
      const entries = listEnabledPluginEntries({
        scope: "project",
        projectPath: project.folderPath,
      });
      for (const item of listPluginMcps(entries)) {
        mcpSet.add(item.name);
      }
    }

    const mcps = Array.from(mcpSet).sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ mcps });
  } catch (error) {
    console.error("Failed to list project MCPs:", error);
    return NextResponse.json({ mcps: [] });
  }
}
