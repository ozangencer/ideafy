import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { removeIdeafyHook } from "@/lib/hooks";
import { DEFAULT_VOICE, type Voice } from "@/lib/types";

const VALID_VOICES: Voice[] = ["entrepreneur", "builder", "engineer"];
const normalizeVoice = (v: unknown, fallback: Voice = DEFAULT_VOICE): Voice =>
  typeof v === "string" && (VALID_VOICES as string[]).includes(v) ? (v as Voice) : fallback;

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .get();

    if (!existing) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Handle documentPaths - convert array to JSON string for storage
    let documentPaths = existing.documentPaths;
    if (body.documentPaths !== undefined) {
      documentPaths = body.documentPaths ? JSON.stringify(body.documentPaths) : null;
    }

    // Handle narrativePath
    let narrativePath = existing.narrativePath;
    if (body.narrativePath !== undefined) {
      narrativePath = body.narrativePath || null;
    }

    // Handle useWorktrees
    let useWorktrees = existing.useWorktrees ?? true;
    if (body.useWorktrees !== undefined) {
      useWorktrees = body.useWorktrees;
    }

    // Handle voice
    let voice: Voice = normalizeVoice(existing.voice);
    if (body.voice !== undefined) {
      voice = normalizeVoice(body.voice, voice);
    }

    const updatedProject = {
      name: body.name ?? existing.name,
      folderPath: body.folderPath ?? existing.folderPath,
      idPrefix: body.idPrefix ?? existing.idPrefix,
      color: body.color ?? existing.color,
      isPinned: body.isPinned ?? existing.isPinned,
      documentPaths,
      narrativePath,
      useWorktrees,
      voice,
      updatedAt: new Date().toISOString(),
    };

    db.update(schema.projects)
      .set(updatedProject)
      .where(eq(schema.projects.id, id))
      .run();

    // Return with documentPaths as array (not JSON string)
    return NextResponse.json({
      ...existing,
      ...updatedProject,
      documentPaths: updatedProject.documentPaths
        ? JSON.parse(updatedProject.documentPaths)
        : null,
      narrativePath: updatedProject.narrativePath,
      useWorktrees: updatedProject.useWorktrees,
      voice: updatedProject.voice,
    });
  } catch (error) {
    console.error("Failed to update project:", error);
    return NextResponse.json(
      { error: "Failed to update project" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const existing = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .get();

    if (!existing) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Remove ideafy hook from project folder
    if (existing.folderPath) {
      const hookResult = removeIdeafyHook(existing.folderPath);
      if (!hookResult.success) {
        console.warn("Failed to remove ideafy hook:", hookResult.error);
      }
    }

    // Delete or unlink cards based on query param
    const { searchParams } = new URL(request.url);
    const deleteCards = searchParams.get("deleteCards") === "true";

    if (deleteCards) {
      db.delete(schema.cards).where(eq(schema.cards.projectId, id)).run();
    } else {
      db.update(schema.cards)
        .set({ projectId: null })
        .where(eq(schema.cards.projectId, id))
        .run();
    }

    db.delete(schema.projects).where(eq(schema.projects.id, id)).run();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete project:", error);
    return NextResponse.json(
      { error: "Failed to delete project" },
      { status: 500 }
    );
  }
}
