import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { db, schema } from "@/lib/db";
import { Project } from "@/lib/types";
import {
  normalizeRunMode,
  normalizeVoice,
  serializeProject,
} from "@/lib/project-serialize";
import { installIdeafyHook } from "@/lib/hooks";

export async function GET() {
  try {
    const rows = db.select().from(schema.projects).all();

    const projects: Project[] = rows
      .map(serializeProject)
      .sort((a, b) => {
        if (a.isPinned !== b.isPinned) return b.isPinned ? 1 : -1;
        return a.name.localeCompare(b.name);
      });

    return NextResponse.json(projects);
  } catch (error) {
    console.error("Failed to fetch projects:", error);
    return NextResponse.json(
      { error: "Failed to fetch projects" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const now = new Date().toISOString();

    const prefix =
      body.idPrefix ||
      body.name
        .replace(/[^a-zA-Z0-9]/g, "")
        .substring(0, 3)
        .toUpperCase() ||
      "PRJ";

    const newProject = {
      id: uuidv4(),
      name: body.name,
      folderPath: body.folderPath,
      idPrefix: prefix,
      nextTaskNumber: 1,
      color: body.color || "#5e6ad2",
      isPinned: body.isPinned || false,
      documentPaths: body.documentPaths ? JSON.stringify(body.documentPaths) : null,
      narrativePath: body.narrativePath || null,
      useWorktrees: body.useWorktrees ?? true,
      voice: normalizeVoice(body.voice),
      runMode: normalizeRunMode(body.runMode),
      runCommand: body.runCommand || null,
      previewUrl: body.previewUrl || null,
      sharedPaths: body.sharedPaths ? JSON.stringify(body.sharedPaths) : null,
      cmuxWorkspaceId: null,
      createdAt: now,
      updatedAt: now,
    };

    db.insert(schema.projects).values(newProject).run();

    // Install ideafy hook to project folder
    if (body.folderPath) {
      const hookResult = installIdeafyHook(body.folderPath);
      if (!hookResult.success) {
        console.warn("Failed to install ideafy hook:", hookResult.error);
      }
    }

    return NextResponse.json(serializeProject(newProject), { status: 201 });
  } catch (error) {
    console.error("Failed to create project:", error);
    return NextResponse.json(
      { error: "Failed to create project" },
      { status: 500 }
    );
  }
}
