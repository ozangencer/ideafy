import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { installIdeafySkills, removeIdeafySkills, hasIdeafySkills } from "@/lib/mcp-skills-installer";

// Check if ideafy skills are installed
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
      return NextResponse.json({ installed: false, reason: "no_folder" });
    }

    const installed = hasIdeafySkills(project.folderPath);
    return NextResponse.json({ installed });
  } catch (error) {
    console.error("Failed to check skills status:", error);
    return NextResponse.json(
      { error: "Failed to check skills status" },
      { status: 500 }
    );
  }
}

// Install ideafy skills
export async function POST(
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
      return NextResponse.json(
        { error: "Project has no folder path" },
        { status: 400 }
      );
    }

    const result = installIdeafySkills(project.folderPath);

    if (result.success) {
      return NextResponse.json({ success: true, installed: true });
    } else {
      return NextResponse.json(
        { error: result.error || "Failed to install skills" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Failed to install skills:", error);
    return NextResponse.json(
      { error: "Failed to install skills" },
      { status: 500 }
    );
  }
}

// Remove ideafy skills
export async function DELETE(
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
      return NextResponse.json(
        { error: "Project has no folder path" },
        { status: 400 }
      );
    }

    const result = removeIdeafySkills(project.folderPath);

    if (result.success) {
      return NextResponse.json({ success: true, installed: false });
    } else {
      return NextResponse.json(
        { error: result.error || "Failed to remove skills" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Failed to remove skills:", error);
    return NextResponse.json(
      { error: "Failed to remove skills" },
      { status: 500 }
    );
  }
}
