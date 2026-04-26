import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { db, schema } from "@/lib/db";
import { Project, DEFAULT_VOICE, type Voice } from "@/lib/types";
import { installIdeafyHook } from "@/lib/hooks";

const VALID_VOICES: Voice[] = ["entrepreneur", "builder", "engineer"];
const normalizeVoice = (v: unknown): Voice =>
  typeof v === "string" && (VALID_VOICES as string[]).includes(v) ? (v as Voice) : DEFAULT_VOICE;

export async function GET() {
  try {
    const rows = db.select().from(schema.projects).all();

    const projects: Project[] = rows
      .map((row) => ({
        id: row.id,
        name: row.name,
        folderPath: row.folderPath,
        idPrefix: row.idPrefix,
        nextTaskNumber: row.nextTaskNumber,
        color: row.color,
        isPinned: row.isPinned,
        documentPaths: row.documentPaths ? JSON.parse(row.documentPaths) : null,
        narrativePath: row.narrativePath,
        useWorktrees: row.useWorktrees ?? true,
        voice: normalizeVoice(row.voice),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }))
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

    // Return with documentPaths as array (not JSON string)
    const responseProject = {
      ...newProject,
      documentPaths: body.documentPaths || null,
      narrativePath: body.narrativePath || null,
      useWorktrees: newProject.useWorktrees,
      voice: newProject.voice,
    };
    return NextResponse.json(responseProject, { status: 201 });
  } catch (error) {
    console.error("Failed to create project:", error);
    return NextResponse.json(
      { error: "Failed to create project" },
      { status: 500 }
    );
  }
}
