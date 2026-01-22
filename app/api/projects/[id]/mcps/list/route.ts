import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { listProjectMcps } from "@/lib/mcp-skills-installer";

// List MCPs in project's .claude/settings.json
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

    const mcps = listProjectMcps(project.folderPath);
    return NextResponse.json({ mcps });
  } catch (error) {
    console.error("Failed to list project MCPs:", error);
    return NextResponse.json({ mcps: [] });
  }
}
