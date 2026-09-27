import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { removeIdeafyHook } from "@/lib/hooks";
import { type Voice } from "@/lib/types";
import {
  normalizeProjectMode,
  normalizeRunMode,
  normalizeVoice,
  serializeProject,
} from "@/lib/project-serialize";

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

    // Switching mode moves no card: status ids are shared, only the workspace
    // that lists the project and its column labels change.
    let mode = normalizeProjectMode(existing.mode);
    if (body.mode !== undefined) {
      mode = normalizeProjectMode(body.mode, mode);
    }

    // Handle run target settings. Each is an explicit override where null means
    // "fall back to detection / the mode default", so an empty string clears it.
    let runMode = existing.runMode;
    if (body.runMode !== undefined) {
      runMode = normalizeRunMode(body.runMode);
    }

    let runCommand = existing.runCommand;
    if (body.runCommand !== undefined) {
      runCommand = body.runCommand?.trim() || null;
    }

    let previewUrl = existing.previewUrl;
    if (body.previewUrl !== undefined) {
      previewUrl = body.previewUrl?.trim() || null;
    }

    let sharedPaths = existing.sharedPaths;
    if (body.sharedPaths !== undefined) {
      sharedPaths =
        Array.isArray(body.sharedPaths) && body.sharedPaths.length > 0
          ? JSON.stringify(body.sharedPaths)
          : null;
    }

    // Empty string is how the picker spells "back to matching by folder".
    let cmuxWorkspaceId = existing.cmuxWorkspaceId;
    if (body.cmuxWorkspaceId !== undefined) {
      cmuxWorkspaceId = body.cmuxWorkspaceId?.trim() || null;
    }

    // Empty string or null takes the project out of its section. An id that
    // names no section is rejected rather than stored as a dangling pointer.
    let sectionId = existing.sectionId;
    if (body.sectionId !== undefined) {
      sectionId = typeof body.sectionId === "string" ? body.sectionId.trim() || null : null;
      if (sectionId) {
        const section = db
          .select({ id: schema.projectSections.id })
          .from(schema.projectSections)
          .where(eq(schema.projectSections.id, sectionId))
          .get();
        if (!section) {
          return NextResponse.json({ error: "Section not found" }, { status: 400 });
        }
      }
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
      mode,
      runMode,
      runCommand,
      previewUrl,
      sharedPaths,
      cmuxWorkspaceId,
      sectionId,
      updatedAt: new Date().toISOString(),
    };

    db.update(schema.projects)
      .set(updatedProject)
      .where(eq(schema.projects.id, id))
      .run();

    return NextResponse.json(serializeProject({ ...existing, ...updatedProject }));
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
