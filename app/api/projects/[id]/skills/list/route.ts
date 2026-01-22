import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { listProjectSkills } from "@/lib/mcp-skills-installer";

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
      return NextResponse.json({ skills: [] });
    }

    const skills = listProjectSkills(project.folderPath);
    return NextResponse.json({ skills });
  } catch (error) {
    console.error("Failed to list project skills:", error);
    return NextResponse.json({ skills: [] });
  }
}
