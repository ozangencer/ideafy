import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { db, schema } from "@/lib/db";
import { DocumentFile } from "@/lib/types";
import {
  claudeMemoryDirExists,
  getClaudeMemoryDir,
} from "@/lib/claude-memory";

// GET /api/projects/[id]/memory
// Returns DocumentFile[] for the Claude auto-memory folder of this project.
// Returns [] when ai_platform !== "claude" or memory folder does not exist.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Only surface memory when Claude is the active platform
    const platformRow = db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, "ai_platform"))
      .get();
    const platform = platformRow?.value ?? "claude";
    if (platform !== "claude") {
      return NextResponse.json([]);
    }

    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .get();

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (!claudeMemoryDirExists(project.folderPath)) {
      return NextResponse.json([]);
    }

    const memoryDir = getClaudeMemoryDir(project.folderPath);
    const entries = fs.readdirSync(memoryDir, { withFileTypes: true });

    const files: DocumentFile[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const fullPath = path.join(memoryDir, entry.name);
      files.push({
        name: entry.name,
        path: fullPath,
        relativePath: entry.name,
        isClaudeMd: false,
        source: "memory",
      });
    }

    // MEMORY.md pinned first, rest alphabetical
    files.sort((a, b) => {
      if (a.name === "MEMORY.md") return -1;
      if (b.name === "MEMORY.md") return 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json(files);
  } catch (error) {
    console.error("Failed to fetch memory files:", error);
    return NextResponse.json([]);
  }
}
