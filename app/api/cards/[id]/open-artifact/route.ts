import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { realpathSync, statSync } from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCardImageDir } from "@/lib/prompts";
import { getClaudeMemoryDir } from "@/lib/claude-memory";

const execFileAsync = promisify(execFile);

// Opening these would run code rather than show a document; Finder gets
// them instead and the user decides.
const EXECUTABLE_EXT = new Set([
  ".app",
  ".command",
  ".sh",
  ".terminal",
  ".workflow",
  ".pkg",
  ".scpt",
  ".tool",
  ".action",
]);

function realOrNull(p: string | null | undefined): string | null {
  if (!p) return null;
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + path.sep);
}

/**
 * POST /api/cards/[id]/open-artifact { path }
 *
 * Opens a file linked from card content. Unlike /api/open-file, which opens
 * whatever path it is handed, this only opens files under the card's own
 * folder, its project folder or the project's Claude memory folder — card
 * HTML can come from MCP callers or a teammate's pool card, and a chip there
 * must not be able to launch an arbitrary binary on click.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const rawPath = typeof body.path === "string" ? body.path : "";

  if (!rawPath || rawPath.includes("\0")) {
    return NextResponse.json({ error: "Path is required" }, { status: 400 });
  }

  const card = db
    .select({ id: schema.cards.id, projectId: schema.cards.projectId })
    .from(schema.cards)
    .where(eq(schema.cards.id, id))
    .get();
  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const project = card.projectId
    ? db
        .select({ folderPath: schema.projects.folderPath })
        .from(schema.projects)
        .where(eq(schema.projects.id, card.projectId))
        .get()
    : null;
  const projectFolder = project?.folderPath || null;

  // Document chips store project-relative paths; artifacts are absolute.
  const absolute = path.isAbsolute(rawPath)
    ? rawPath
    : projectFolder
      ? path.resolve(projectFolder, rawPath)
      : null;
  const target = realOrNull(absolute);
  if (!target) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const roots = [
    realOrNull(getCardImageDir(id)),
    realOrNull(projectFolder),
    projectFolder ? realOrNull(getClaudeMemoryDir(projectFolder)) : null,
  ].filter((root): root is string => Boolean(root));

  if (!roots.some((root) => isInside(target, root))) {
    return NextResponse.json(
      { error: "This file is outside the card's folders" },
      { status: 403 },
    );
  }

  const reveal =
    EXECUTABLE_EXT.has(path.extname(target).toLowerCase()) || statSync(target).isDirectory();

  try {
    await execFileAsync("open", reveal ? ["-R", target] : [target]);
    return NextResponse.json({ success: true, revealed: reveal });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to open file";
    console.error("Failed to open artifact:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
