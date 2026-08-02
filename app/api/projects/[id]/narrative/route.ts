import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import * as fs from "fs";
import * as path from "path";
import {
  buildNarrativePrompt,
  generateFallbackContent,
  type NarrativeData,
} from "@/lib/prompts";
import { runAutonomousCli } from "@/lib/autonomous-run/run-autonomous-cli";
import { safeResolvePath } from "@/lib/path-utils";

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
  const { response } = await runAutonomousCli({
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
  return content;
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
  const body: NarrativeData = await request.json();

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
    const prompt = buildNarrativePrompt(project.name, body);

    console.log("Running AI CLI for narrative generation...");

    const narrativeContent = await generateNarrative(prompt, project.folderPath);

    // Write narrative to file
    fs.writeFileSync(narrativePath, narrativeContent, "utf-8");

    return NextResponse.json({
      success: true,
      path: narrativePath,
      message: "Product narrative created with AI assistance",
      aiGenerated: true,
    });
  } catch (error) {
    console.error("Error creating narrative with AI CLI:", error);

    // Fallback to simple template if Claude fails
    try {
      const fallbackContent = generateFallbackContent(project.name, body);
      fs.writeFileSync(narrativePath, fallbackContent, "utf-8");

      return NextResponse.json({
        success: true,
        path: narrativePath,
        message: "Product narrative created (fallback - AI unavailable)",
        aiGenerated: false,
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
  const body: NarrativeData = await request.json();

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
    const prompt = buildNarrativePrompt(project.name, body);

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
      const fallbackContent = generateFallbackContent(project.name, body);
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
