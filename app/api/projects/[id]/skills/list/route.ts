import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getActiveProvider } from "@/lib/platform/active";
import { listProjectSkillItems } from "@/lib/skills/catalog";

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
    const items = listProjectSkillItems(project.folderPath, provider.id);
    const skills = items.map((item) => item.name);
    return NextResponse.json({ skills, items });
  } catch (error) {
    console.error("Failed to list project skills:", error);
    return NextResponse.json({ skills: [], items: [] });
  }
}
