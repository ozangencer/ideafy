import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exec } from "child_process";
import { promisify } from "util";
import { marked } from "marked";
import {
  stripHtml,
  convertToTipTapTaskList,
  escapeShellArg,
  buildEvaluatePrompt,
} from "@/lib/prompts";

const execAsync = promisify(exec);

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

  console.log(`[Evaluate] Starting evaluation for card ${id}`);
  console.log(`[Evaluate] Working dir: ${workingDir}`);
  console.log(`[Evaluate] Narrative path: ${narrativePath || 'default (docs/product-narrative.md)'}`);

  // Mark card as processing (persists through page refresh)
  db.update(schema.cards)
    .set({ processingType: "evaluate" })
    .where(eq(schema.cards.id, id))
    .run();

  try {
    const prompt = buildEvaluatePrompt(card, narrativePath);
    const escapedPrompt = escapeShellArg(prompt);

    // Use permission-mode dontAsk since we're only reading files for context
    const command = `CI=true claude -p ${escapedPrompt} --permission-mode dontAsk --output-format json < /dev/null`;

    console.log(`[Evaluate] Prompt length: ${prompt.length} chars`);

    const { stdout, stderr } = await execAsync(command, {
      cwd: workingDir,
      timeout: 5 * 60 * 1000, // 5 minute timeout
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    if (stderr) {
      console.log(`[Evaluate] stderr: ${stderr}`);
    }

    let responseText = stdout.trim();
    let cost: number | undefined;
    let duration: number | undefined;

    try {
      const response: ClaudeResponse = JSON.parse(stdout);
      if (response.is_error) {
        throw new Error(response.result || "Claude returned an error");
      }
      responseText = response.result || "";
      cost = response.cost_usd;
      duration = response.duration_ms;
    } catch {
      console.log(`[Evaluate] JSON parse failed, using raw output`);
    }

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
