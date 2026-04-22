import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import fs from "fs";
import path from "path";
import { isInsideClaudeMemory } from "@/lib/claude-memory";

// Security: validate path is within a known project folder OR a project's
// Claude memory directory (which lives under ~/.claude/projects/<hash>/memory/).
function validatePath(filePath: string): boolean {
  const projects = db.select().from(schema.projects).all();
  const normalizedPath = path.resolve(filePath);

  const inProjectFolder = projects.some((project) => {
    // Use path.resolve + trailing separator to prevent prefix attacks
    // e.g. /home/user/proj matching /home/user/project-private
    const normalizedFolder = path.resolve(project.folderPath) + path.sep;
    return normalizedPath.startsWith(normalizedFolder) || normalizedPath === normalizedFolder.slice(0, -1);
  });
  if (inProjectFolder) return true;

  return isInsideClaudeMemory(
    normalizedPath,
    projects.map((p) => p.folderPath)
  );
}

// Documents route ships Markdown-only content: the product-narrative and
// other per-project docs edited through the in-app editor. Restrict both
// read and write to .md files outside hidden/tooling directories so this
// endpoint can't be repurposed into reading .env or planting a git hook.
// Exception: Claude memory lives under ~/.claude/projects/, which contains
// leading-dot segments — allow those paths explicitly.
function isAllowedDocPath(
  filePath: string,
  projectFolderPaths: string[]
): boolean {
  const resolved = path.resolve(filePath);
  if (!resolved.toLowerCase().endsWith(".md")) return false;

  if (isInsideClaudeMemory(resolved, projectFolderPaths)) return true;

  const segments = resolved.split(path.sep);
  for (const seg of segments) {
    if (seg === "" || seg === "..") continue;
    if (seg.startsWith(".")) return false; // .git, .env, .worktrees, …
    if (seg === "node_modules") return false;
  }
  return true;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get("path");

    if (!filePath) {
      return NextResponse.json({ error: "Path required" }, { status: 400 });
    }

    const projectFolderPaths = db
      .select()
      .from(schema.projects)
      .all()
      .map((p) => p.folderPath);
    if (!validatePath(filePath) || !isAllowedDocPath(filePath, projectFolderPaths)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const content = fs.readFileSync(filePath, "utf-8");
    return NextResponse.json({ content, path: filePath });
  } catch (error) {
    console.error("Failed to read document:", error);
    return NextResponse.json(
      { error: "Failed to read document" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get("path");

    if (!filePath) {
      return NextResponse.json({ error: "Path required" }, { status: 400 });
    }

    const projectFolderPaths = db
      .select()
      .from(schema.projects)
      .all()
      .map((p) => p.folderPath);
    if (!validatePath(filePath) || !isAllowedDocPath(filePath, projectFolderPaths)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const body = await request.json();

    if (typeof body.content !== "string") {
      return NextResponse.json(
        { error: "Content must be a string" },
        { status: 400 }
      );
    }

    fs.writeFileSync(filePath, body.content, "utf-8");
    return NextResponse.json({ success: true, path: filePath });
  } catch (error) {
    console.error("Failed to write document:", error);
    return NextResponse.json(
      { error: "Failed to write document" },
      { status: 500 }
    );
  }
}
