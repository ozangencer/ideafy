import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import * as fs from "fs";
import * as path from "path";
import {
  buildNarrativePrompt,
  buildWorkBriefPrompt,
  generateFallbackContent,
  generateWorkBriefFallback,
  type NarrativeData,
  type WorkBriefData,
} from "@/lib/prompts";
import { runAutonomousCli } from "@/lib/autonomous-run/run-autonomous-cli";
import { prependWarningMarkdown } from "@/lib/autonomous-run/select-run-output";
import { safeResolvePath } from "@/lib/path-utils";
import { addBriefPointer } from "@/lib/brief-pointer";

/**
 * Generate narrative markdown by running the active provider's CLI.
 *
 * Untracked (no card behind it, so nothing to show in the process registry) and
 * stricter about the exit code than the card-driven runs: a non-zero exit is a
 * failure even if it produced output, because the caller's fallback writes a
 * usable template and that beats persisting a half-finished document.
 *
 * Throws on empty output for the same reason — the previous behaviour wrote the
 * CLI's raw stdout into the user's narrative file when the parsed result came
 * back empty, which meant a run that produced nothing usable left raw JSON in
 * `product-narrative.md`. Failing here routes it to `generateFallbackContent`.
 */
async function generateNarrative(prompt: string, cwd: string): Promise<string> {
  // No contract: a narrative is free-form markdown with no marker to key on, so
  // the runner falls back to picking the longest text run and warns when that
  // differs from the last thing said.
  const { response, warning } = await runAutonomousCli({
    prompt,
    cwd,
    requireExitZero: true,
  });

  const content = response
    .replace(/^```markdown\n?/g, "")
    .replace(/\n?```$/g, "")
    .trim();

  if (!content) {
    throw new Error("Narrative generation produced no content");
  }
  return warning ? prependWarningMarkdown(content, warning) : content;
}

/**
 * A Work project gets a project brief instead of a product narrative. The
 * wizard sends whichever answers it asked for; the project's mode decides how
 * they are read, so a Work body never lands in the product template.
 */
function pickBuilder(project: { name: string; mode: string | null }, body: unknown) {
  if (project.mode === "work") {
    const data = body as WorkBriefData;
    return {
      prompt: buildWorkBriefPrompt(project.name, data),
      fallback: () => generateWorkBriefFallback(project.name, data),
    };
  }
  const data = body as NarrativeData;
  return {
    prompt: buildNarrativePrompt(project.name, data),
    fallback: () => generateFallbackContent(project.name, data),
  };
}

/**
 * The Work wizard's "Add a pointer to CLAUDE.md" box arrives as
 * `?briefPointer=1` (the body is read as the brief's answers, so it stays out
 * of there). Called only after the brief is on disk, so the line never points
 * at a file that is not there. A failure here does not fail the brief.
 */
function maybeAddBriefPointer(
  request: NextRequest,
  project: { folderPath: string; mode: string | null },
  relativePath: string
) {
  if (request.nextUrl.searchParams.get("briefPointer") !== "1" || project.mode !== "work") {
    return {};
  }
  try {
    const { result, file } = addBriefPointer(project.folderPath, relativePath);
    return { pointer: result, pointerFile: file };
  } catch (error) {
    console.error("Error adding brief pointer:", error);
    return { pointer: "failed" as const };
  }
}

// GET - Read narrative from project folder
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .get();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const relativePath = project.narrativePath || "docs/product-narrative.md";
  const narrativePath = safeResolvePath(project.folderPath, relativePath);

  if (!narrativePath) {
    return NextResponse.json({ error: "Invalid narrative path" }, { status: 400 });
  }

  try {
    if (fs.existsSync(narrativePath)) {
      const content = fs.readFileSync(narrativePath, "utf-8");
      return NextResponse.json({
        exists: true,
        content,
        path: narrativePath
      });
    } else {
      return NextResponse.json({
        exists: false,
        content: null,
        path: narrativePath
      });
    }
  } catch (error) {
    console.error("Error reading narrative:", error);
    return NextResponse.json(
      { error: "Failed to read narrative", details: String(error) },
      { status: 500 }
    );
  }
}

// POST - Create narrative in project folder using Claude AI
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body: unknown = await request.json();

  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .get();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const relativePath = project.narrativePath || "docs/product-narrative.md";
  const narrativePath = safeResolvePath(project.folderPath, relativePath);

  if (!narrativePath) {
    return NextResponse.json({ error: "Invalid narrative path" }, { status: 400 });
  }

  const narrativeDir = path.dirname(narrativePath);

  try {
    // Create parent directory if it doesn't exist
    if (!fs.existsSync(narrativeDir)) {
      fs.mkdirSync(narrativeDir, { recursive: true });
    }

    // Build prompt for Claude
    const { prompt } = pickBuilder(project, body);

    console.log("Running AI CLI for narrative generation...");

    const narrativeContent = await generateNarrative(prompt, project.folderPath);

    // Write narrative to file
    fs.writeFileSync(narrativePath, narrativeContent, "utf-8");

    return NextResponse.json({
      success: true,
      path: narrativePath,
      message: "Product narrative created with AI assistance",
      aiGenerated: true,
      ...maybeAddBriefPointer(request, project, relativePath),
    });
  } catch (error) {
    console.error("Error creating narrative with AI CLI:", error);

    // Fallback to simple template if Claude fails
    try {
      const fallbackContent = pickBuilder(project, body).fallback();
      fs.writeFileSync(narrativePath, fallbackContent, "utf-8");

      return NextResponse.json({
        success: true,
        path: narrativePath,
        message: "Product narrative created (fallback - AI unavailable)",
        aiGenerated: false,
        ...maybeAddBriefPointer(request, project, relativePath),
      });
    } catch (fallbackError) {
      return NextResponse.json(
        { error: "Failed to create narrative", details: String(error) },
        { status: 500 }
      );
    }
  }
}

// PUT - Update existing narrative using Claude AI
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body: unknown = await request.json();

  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .get();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const relativePath = project.narrativePath || "docs/product-narrative.md";
  const narrativePath = safeResolvePath(project.folderPath, relativePath);

  if (!narrativePath) {
    return NextResponse.json({ error: "Invalid narrative path" }, { status: 400 });
  }

  const narrativeDir = path.dirname(narrativePath);

  try {
    // Create parent directory if it doesn't exist
    if (!fs.existsSync(narrativeDir)) {
      fs.mkdirSync(narrativeDir, { recursive: true });
    }

    // Build prompt for Claude
    const { prompt } = pickBuilder(project, body);

    console.log("Running AI CLI for narrative update...");

    const narrativeContent = await generateNarrative(prompt, project.folderPath);

    // Write narrative to file
    fs.writeFileSync(narrativePath, narrativeContent, "utf-8");

    return NextResponse.json({
      success: true,
      path: narrativePath,
      message: "Product narrative updated with AI assistance",
      aiGenerated: true,
    });
  } catch (error) {
    console.error("Error updating narrative with AI CLI:", error);

    // Fallback to simple template if Claude fails
    try {
      const fallbackContent = pickBuilder(project, body).fallback();
      fs.writeFileSync(narrativePath, fallbackContent, "utf-8");

      return NextResponse.json({
        success: true,
        path: narrativePath,
        message: "Product narrative updated (fallback - AI unavailable)",
        aiGenerated: false,
      });
    } catch (fallbackError) {
      return NextResponse.json(
        { error: "Failed to update narrative", details: String(error) },
        { status: 500 }
      );
    }
  }
}
