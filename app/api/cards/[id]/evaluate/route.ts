import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { spawn } from "child_process";
import { marked } from "marked";
import {
  stripHtml,
  convertToTipTapTaskList,
  buildEvaluatePrompt,
} from "@/lib/prompts";
import {
  registerProcess,
  completeProcess,
  getProcess,
  killProcess,
} from "@/lib/process-registry";
import { getClaudePath, getClaudeCIEnv } from "@/lib/claude-cli";

interface ClaudeResponse {
  result?: string;
  cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  is_error?: boolean;
  num_turns?: number;
  session_id?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Get the card from database
  const card = db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.id, id))
    .get();

  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  // Verify card is in ideation status
  if (card.status !== "ideation") {
    return NextResponse.json(
      { error: "Evaluate is only available for cards in Ideation column" },
      { status: 400 }
    );
  }

  // Get project for working directory
  const project = card.projectId
    ? db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, card.projectId))
        .get()
    : null;

  const workingDir = project?.folderPath || card.projectFolder || process.cwd();

  if (!card.description || stripHtml(card.description) === "") {
    return NextResponse.json(
      { error: "Card has no description to evaluate" },
      { status: 400 }
    );
  }

  // Get narrativePath from project
  const narrativePath = project?.narrativePath || null;

  // Compute display ID for process tracking
  const displayId = project && card.taskNumber
    ? `${project.idPrefix}-${card.taskNumber}`
    : null;
  const processKey = `${id}-evaluate`;

  console.log(`[Evaluate] Starting evaluation for card ${id}`);
  console.log(`[Evaluate] Working dir: ${workingDir}`);
  console.log(`[Evaluate] Narrative path: ${narrativePath || 'default (docs/product-narrative.md)'}`);

  // Kill any existing process for this card
  const existing = getProcess(processKey);
  if (existing) {
    killProcess(processKey);
  }

  // Mark card as processing (persists through page refresh)
  db.update(schema.cards)
    .set({ processingType: "evaluate" })
    .where(eq(schema.cards.id, id))
    .run();

  try {
    const prompt = buildEvaluatePrompt(card, narrativePath);

    console.log(`[Evaluate] Prompt length: ${prompt.length} chars`);

    // Run Claude CLI with spawn for process tracking
    const { responseText, cost, duration } = await new Promise<{
      responseText: string;
      cost?: number;
      duration?: number;
    }>((resolve, reject) => {
      const claudeProcess = spawn(getClaudePath(), [
        "-p", prompt,
        "--permission-mode", "dontAsk",
        "--output-format", "json",
      ], {
        cwd: workingDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: getClaudeCIEnv(),
      });

      // Close stdin immediately
      claudeProcess.stdin?.end();

      // Register process for tracking
      registerProcess(processKey, claudeProcess, {
        cardId: id,
        sectionType: null,
        processType: "evaluate",
        cardTitle: card.title,
        displayId,
        startedAt: new Date().toISOString(),
      });

      let stdout = "";
      let stderr = "";

      claudeProcess.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      claudeProcess.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      // Set timeout (5 minutes for evaluate)
      const timeout = setTimeout(() => {
        claudeProcess.kill();
        completeProcess(processKey);
        reject(new Error("Evaluate timed out after 5 minutes"));
      }, 5 * 60 * 1000);

      claudeProcess.on("close", (code) => {
        clearTimeout(timeout);
        completeProcess(processKey);

        if (stderr) {
          console.log(`[Evaluate] stderr: ${stderr}`);
        }

        if (code !== 0 && !stdout.trim()) {
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          const response: ClaudeResponse = JSON.parse(stdout);
          if (response.is_error) {
            reject(new Error(response.result || "Claude returned an error"));
            return;
          }
          resolve({
            responseText: response.result || "",
            cost: response.cost_usd,
            duration: response.duration_ms,
          });
        } catch {
          console.log(`[Evaluate] JSON parse failed, using raw output`);
          resolve({ responseText: stdout.trim() });
        }
      });

      claudeProcess.on("error", (error) => {
        clearTimeout(timeout);
        completeProcess(processKey);
        reject(error);
      });
    });

    // Convert markdown response to HTML for TipTap editor
    const markedHtml = await marked(responseText);
    const aiOpinion = convertToTipTapTaskList(markedHtml);

    // Extract verdict from "## Summary Verdict" section
    const verdictMatch = responseText.match(/##\s*Summary\s*Verdict[\s\S]*?(Strong\s*Yes|Yes|Maybe|No|Strong\s*No)/i);
    const verdictText = verdictMatch?.[1]?.toLowerCase().replace(/\s+/g, '') || '';

    // Also check final score as backup (e.g., 7/10)
    const scoreMatch = responseText.match(/##\s*Final\s*Score[\s\S]*?(\d+)\/10/i);
    const score = scoreMatch ? parseInt(scoreMatch[1], 10) : null;

    // Determine verdict: positive if "yes/strong yes/maybe with score >= 6"
    let aiVerdict: "positive" | "negative" | null = null;
    if (verdictText === 'strongyes' || verdictText === 'yes') {
      aiVerdict = 'positive';
    } else if (verdictText === 'no' || verdictText === 'strongno') {
      aiVerdict = 'negative';
    } else if (verdictText === 'maybe' && score !== null) {
      aiVerdict = score >= 6 ? 'positive' : 'negative';
    }

    // Extract priority from response
    let priority: "low" | "medium" | "high" | null = null;
    const priorityMatch = responseText.match(/\[PRIORITY:\s*(low|medium|high)\]/i);
    if (priorityMatch) {
      priority = priorityMatch[1].toLowerCase() as "low" | "medium" | "high";
    }

    // Extract complexity from response
    let complexity: "trivial" | "low" | "medium" | "high" | "very_high" | null = null;
    const complexityMatch = responseText.match(/\[COMPLEXITY:\s*(trivial|low|medium|high|very_high)\]/i);
    if (complexityMatch) {
      complexity = complexityMatch[1].toLowerCase() as "trivial" | "low" | "medium" | "high" | "very_high";
    }

    // Update database - update aiOpinion, aiVerdict, priority, and complexity (if found)
    const updatedAt = new Date().toISOString();
    const updates: { aiOpinion: string; aiVerdict: string | null; updatedAt: string; priority?: string; complexity?: string } = {
      aiOpinion,
      aiVerdict,
      updatedAt,
    };

    if (priority) {
      updates.priority = priority;
      console.log(`[Evaluate] Updating priority to: ${priority}`);
    }

    if (complexity) {
      updates.complexity = complexity;
      console.log(`[Evaluate] Updating complexity to: ${complexity}`);
    }

    if (aiVerdict) {
      console.log(`[Evaluate] Updating verdict to: ${aiVerdict}`);
    }

    // Clear processing flag on success
    db.update(schema.cards)
      .set({ ...updates, processingType: null })
      .where(eq(schema.cards.id, id))
      .run();

    return NextResponse.json({
      success: true,
      cardId: id,
      aiOpinion,
      aiVerdict,
      priority,
      complexity,
      cost,
      duration,
    });
  } catch (error) {
    console.error("Evaluate error:", error);
    // Clear processing flag on error
    db.update(schema.cards)
      .set({ processingType: null })
      .where(eq(schema.cards.id, id))
      .run();
    return NextResponse.json(
      {
        error: "Failed to evaluate idea",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
