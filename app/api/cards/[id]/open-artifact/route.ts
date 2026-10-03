import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { statSync } from "fs";
import path from "path";
import { artifactRootsFor, resolveArtifactPath } from "@/lib/artifact-roots";

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

  const scope = artifactRootsFor(id);
  if (!scope) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const resolved = resolveArtifactPath(rawPath, scope.roots, scope.projectFolder);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const target = resolved.target;

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
