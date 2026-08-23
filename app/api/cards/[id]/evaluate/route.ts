import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { marked } from "marked";
import {
  stripHtml,
  convertToTipTapTaskList,
  buildEvaluatePrompt,
} from "@/lib/prompts";
import { getProcess, killProcess } from "@/lib/process-registry";
import { runAutonomousCli, completeProcess } from "@/lib/autonomous-run/run-autonomous-cli";
import {
  RUN_OUTPUT_CONTRACTS,
  prependWarningHtml,
} from "@/lib/autonomous-run/select-run-output";
import { isMissingDependencyError } from "@/lib/platform/base-provider";
import { getProviderForCard } from "@/lib/platform/active";
import { recordOpinionCompleted } from "@/lib/activity-registry";

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
    const prompt = buildEvaluatePrompt(
      card,
      narrativePath,
      project?.voice as never,
      getProviderForCard(card).id,
    );

    console.log(`[Evaluate] Prompt length: ${prompt.length} chars`);

    const { response: responseText, warning, cost, duration } = await runAutonomousCli({
      prompt,
      cwd: workingDir,
      aiPlatform: card.aiPlatform,
      label: "Evaluate",
      timeoutMs: 5 * 60 * 1000,
      contract: RUN_OUTPUT_CONTRACTS.evaluate,
      tracking: {
        processKey,
        cardId: id,
        cardTitle: card.title,
        displayId,
        processType: "evaluate",
      },
    });

    // Convert markdown response to HTML for TipTap editor
    const markedHtml = await marked(responseText);
    let aiOpinion = convertToTipTapTaskList(markedHtml);
    if (warning) {
      aiOpinion = prependWarningHtml(aiOpinion, warning);
    }

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

    // Mark process as completed AFTER DB updates
    completeProcess(processKey);

    // Record completion in the activity inbox so the bell shows the verdict
    // (e.g. "AI Opinion completed — Verdict: Strong Yes (8/10)") even after
    // the user dismisses the toast or refreshes.
    recordOpinionCompleted(id, card.projectId ?? null, {
      verdict: aiVerdict,
      verdictRaw: verdictText,
      score,
    });

    return NextResponse.json({
      success: true,
      cardId: id,
      aiOpinion,
      aiVerdict,
      outputWarning: warning,
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
    completeProcess(processKey);
    if (isMissingDependencyError(error)) {
      return NextResponse.json(
        { error: error.message, dependency: error.binaryName },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        error: "Failed to evaluate idea",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
