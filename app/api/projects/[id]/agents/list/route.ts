import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { listProjectAgents } from "@/lib/mcp-skills-installer";

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
      return NextResponse.json({ agents: [] });
    }

    const agents = listProjectAgents(project.folderPath);
    return NextResponse.json({ agents });
  } catch (error) {
    console.error("Failed to list project agents:", error);
    return NextResponse.json({ agents: [] });
  }
}
