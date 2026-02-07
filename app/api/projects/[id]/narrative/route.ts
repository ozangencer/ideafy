import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import {
  buildNarrativePrompt,
  generateFallbackContent,
  type NarrativeData,
} from "@/lib/prompts";
import { getClaudePath, getClaudeCIEnv } from "@/lib/claude-cli";
import { safeResolvePath } from "@/lib/path-utils";

/**
 * Run Claude CLI using spawn (shell-free) and collect output
 */
function runClaudeCLI(prompt: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const claudePath = getClaudePath();
    const claudeProcess = spawn(
      claudePath,
      ["-p", prompt, "--permission-mode", "dontAsk", "--output-format", "json"],
      {
        cwd,
        env: getClaudeCIEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";

    claudeProcess.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    claudeProcess.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    claudeProcess.stdin.end();

    const timeout = setTimeout(() => {
      claudeProcess.kill("SIGTERM");
      reject(new Error("Claude CLI timed out after 10 minutes"));
    }, 600000);

    claudeProcess.on("close", (code: number | null) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
      }
    });

    claudeProcess.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Parse Claude CLI JSON output to extract narrative content
 */
function parseClaudeOutput(stdout: string): string {
  try {
    const response = JSON.parse(stdout);
    if (response.result) {
      return response.result;
    } else if (Array.isArray(response)) {
      const textBlocks = response.filter((b: { type: string }) => b.type === "text");
      return textBlocks.map((b: { text: string }) => b.text).join("\n");
    }
    return stdout;
  } catch {
    return stdout;
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

    console.log("Running Claude for narrative generation...");

    const stdout = await runClaudeCLI(prompt, project.folderPath);

    // Parse Claude's JSON response
    let narrativeContent = parseClaudeOutput(stdout);

    // Clean up the content (remove JSON artifacts if any)
    narrativeContent = narrativeContent
      .replace(/^```markdown\n?/g, "")
      .replace(/\n?```$/g, "")
      .trim();

    // Write narrative to file
    fs.writeFileSync(narrativePath, narrativeContent, "utf-8");

    return NextResponse.json({
      success: true,
      path: narrativePath,
      message: "Product narrative created with AI assistance",
      aiGenerated: true,
    });
  } catch (error) {
    console.error("Error creating narrative with Claude:", error);

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

    console.log("Running Claude for narrative update...");

    const stdout = await runClaudeCLI(prompt, project.folderPath);

    // Parse Claude's JSON response
    let narrativeContent = parseClaudeOutput(stdout);

    // Clean up the content
    narrativeContent = narrativeContent
      .replace(/^```markdown\n?/g, "")
      .replace(/\n?```$/g, "")
      .trim();

    // Write narrative to file
    fs.writeFileSync(narrativePath, narrativeContent, "utf-8");

    return NextResponse.json({
      success: true,
      path: narrativePath,
      message: "Product narrative updated with AI assistance",
      aiGenerated: true,
    });
  } catch (error) {
    console.error("Error updating narrative with Claude:", error);

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
