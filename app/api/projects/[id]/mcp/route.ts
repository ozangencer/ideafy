import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { installIdeafyMcp, removeIdeafyMcp, hasIdeafyMcp } from "@/lib/mcp-skills-installer";

// Check if ideafy MCP is installed
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

    const installed = hasIdeafyMcp(project.folderPath);
    return NextResponse.json({ installed });
  } catch (error) {
    console.error("Failed to check MCP status:", error);
    return NextResponse.json(
      { error: "Failed to check MCP status" },
      { status: 500 }
    );
  }
}

// Install ideafy MCP
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

    const result = installIdeafyMcp(project.folderPath);

    if (result.success) {
      return NextResponse.json({ success: true, installed: true });
    } else {
      return NextResponse.json(
        { error: result.error || "Failed to install MCP" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Failed to install MCP:", error);
    return NextResponse.json(
      { error: "Failed to install MCP" },
      { status: 500 }
    );
  }
}

// Remove ideafy MCP
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

    const result = removeIdeafyMcp(project.folderPath);

    if (result.success) {
      return NextResponse.json({ success: true, installed: false });
    } else {
      return NextResponse.json(
        { error: result.error || "Failed to remove MCP" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Failed to remove MCP:", error);
    return NextResponse.json(
      { error: "Failed to remove MCP" },
      { status: 500 }
    );
  }
}
