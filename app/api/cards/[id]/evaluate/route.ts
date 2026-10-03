import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema, sqlite } from "@/lib/db";
import { normalizeProjectMode } from "@/lib/project-serialize";
import { loadCardChain } from "@/lib/card-chain";
import { linkCardsInHtml } from "@/lib/card-link-resolver";
import { marked } from "marked";
import {
  stripHtml,
  convertToTipTapTaskList,
  buildEvaluatePrompt,
} from "@/lib/prompts";
import { getProcess, killProcess } from "@/lib/process-registry";
import { runAutonomousCli, completeProcess } from "@/lib/autonomous-run/run-autonomous-cli";
import { describeRunError } from "@/lib/run-error";
import {
  RUN_OUTPUT_CONTRACTS,
  prependWarningHtml,
} from "@/lib/autonomous-run/select-run-output";
import { isMissingDependencyError } from "@/lib/platform/base-provider";
import { getProviderForCard } from "@/lib/platform/active";
import { recordOpinionCompleted } from "@/lib/activity-registry";
import { describeOpinionMarkers, parseOpinionMarkers } from "@/lib/opinion-markers";
import { saveOpinion } from "@/lib/card-ops";

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
      loadCardChain(card),
      normalizeProjectMode(project?.mode),
    );

    console.log(`[Evaluate] Prompt length: ${prompt.length} chars`);

    const { response: responseText, warning, cost, duration } = await runAutonomousCli({
      prompt,
      cwd: workingDir,
      aiPlatform: card.aiPlatform,
      label: "Evaluate",
      timeoutMs: 5 * 60 * 1000,
      runKind: "evaluate",
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
    // Related Cards names cards as "IDE-318"; save them as clickable [[ chips.
    let aiOpinion = linkCardsInHtml(convertToTipTapTaskList(markedHtml), card.projectId);
    if (warning) {
      aiOpinion = prependWarningHtml(aiOpinion, warning);
    }

    // Verdict, score, priority and complexity come from the opinion's markers
    // through lib/card-ops' saveOpinion — the same write Apply and the MCP
    // save_opinion make, so a terminal evaluation lands the same as this one.
    const saved = saveOpinion(sqlite(), {
      id,
      html: aiOpinion,
      source: responseText,
      now: new Date().toISOString(),
    });
    if (!saved.ok) throw new Error("Card disappeared while it was being evaluated");
    const markers = parseOpinionMarkers(responseText);
    console.log(`[Evaluate] Saved ${describeOpinionMarkers(saved) || "opinion with no markers"}`);
    // activity-registry's labels key on the unspaced form ("strongyes").
    const verdictText = markers.verdictWord?.replace("_", "") ?? "";

    // Clear processing flag on success
    db.update(schema.cards)
      .set({ processingType: null })
      .where(eq(schema.cards.id, id))
      .run();

    // Mark process as completed AFTER DB updates
    completeProcess(processKey, "completed", { warning });

    // Record completion in the activity inbox so the bell shows the verdict
    // (e.g. "AI Opinion completed — Verdict: Strong Yes (8/10)") even after
    // the user dismisses the toast or refreshes.
    recordOpinionCompleted(id, card.projectId ?? null, {
      verdict: saved.verdict,
      verdictRaw: verdictText,
      score: saved.score,
    });

    return NextResponse.json({
      success: true,
      cardId: id,
      aiOpinion,
      aiVerdict: saved.verdict,
      aiScore: saved.score,
      outputWarning: warning,
      priority: markers.priority,
      complexity: markers.complexity,
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
    completeProcess(processKey, "failed", { error: describeRunError(error) });
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
