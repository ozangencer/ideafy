import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { realpathSync, statSync } from "fs";
import path from "path";
import { marked } from "marked";
import { db, schema } from "@/lib/db";
import { normalizeProjectMode } from "@/lib/project-serialize";
import { linkCardsInHtml } from "@/lib/card-link-resolver";
import type { Status } from "@/lib/types";
import {
  stripHtml,
  convertToTipTapTaskList,
  buildGeneratePrompt,
  saveCardImagesToTemp,
  generateImageReferences,
} from "@/lib/prompts";
import { runAutonomousCli, completeProcess } from "@/lib/autonomous-run/run-autonomous-cli";
import { describeRunError } from "@/lib/run-error";
import {
  RUN_OUTPUT_CONTRACTS,
  splitGenerateResponse,
  prependWarningHtml,
} from "@/lib/autonomous-run/select-run-output";
import { detectCardLanguage } from "@/lib/prompts/test-style";
import { isMissingDependencyError } from "@/lib/platform/base-provider";
import { parseOutputPaths } from "@/lib/output-paths";
import { normalizeWorkTemplates, resolveWorkTemplate, WORK_TEMPLATES_SETTING_KEY } from "@/lib/work-templates";

// The column a Generate run can leave a card in: still open, still a Work card.
const GENERATE_STATUSES = new Set<Status>(["backlog", "bugs", "progress"]);

// save_output's own wording when the MCP server finds a database without the
// output_paths column (mcp-server/output-paths.ts). A run that hit it saved
// nothing for a reason the user can fix, so the warning names that reason.
const APP_UPDATE_HINT = /does not store output paths yet|Update the Ideafy app/i;

/**
 * POST /api/cards/[id]/generate
 *
 * A Work card's one-shot run: the card and its template go in, a file in the
 * project folder comes out. Built on Quick Fix's skeleton — same processing
 * flag, same tracked autonomous CLI — minus everything that assumes a repo:
 * no worktree, no commit, no placeholder tests.
 *
 * Success is what save_output recorded during this run, not the exit code.
 * The run has full permissions, so the failure that matters is quieter — a
 * python3 script that dies and a model that writes a cheerful summary anyway.
 * A recorded file has to exist and have been written since the run started;
 * without one the card stays where it is and says why.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const card = db.select().from(schema.cards).where(eq(schema.cards.id, id)).get();
  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const project = card.projectId
    ? db.select().from(schema.projects).where(eq(schema.projects.id, card.projectId)).get()
    : null;

  if (normalizeProjectMode(project?.mode) !== "work") {
    return NextResponse.json(
      { error: "Generate is only available for cards in a Work project" },
      { status: 400 }
    );
  }
  if (!GENERATE_STATUSES.has(card.status as Status)) {
    return NextResponse.json(
      { error: "Generate runs on open cards — Backlog, Bugs or In Progress" },
      { status: 400 }
    );
  }
  if (!card.description || stripHtml(card.description) === "") {
    return NextResponse.json({ error: "Card has no description to generate from" }, { status: 400 });
  }

  const workingDir = project?.folderPath || card.projectFolder;
  if (!workingDir) {
    return NextResponse.json({ error: "Card has no project folder to save the output in" }, { status: 400 });
  }

  const templatesRow = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, WORK_TEMPLATES_SETTING_KEY))
    .get();
  const template = resolveWorkTemplate(normalizeWorkTemplates(templatesRow?.value ?? null), card.workTemplateId);

  const displayId = project && card.taskNumber ? `${project.idPrefix}-${card.taskNumber}` : null;
  const processKey = `${id}-generate`;

  console.log(`[Generate] Starting for card ${id} with template "${template.name}" in ${workingDir}`);

  db.update(schema.cards).set({ processingType: "generate" }).where(eq(schema.cards.id, id)).run();

  // A file counts only if it was written during this run. Rounded down a
  // second so a filesystem with coarse mtimes cannot drop a file written in
  // the run's first moment.
  const startedAtMs = Date.now() - 1000;

  try {
    let prompt = buildGeneratePrompt(card, template, project?.voice as never);

    const savedImages = saveCardImagesToTemp(card.id, card);
    const imageReferences = generateImageReferences(savedImages);
    if (imageReferences) {
      prompt = `${prompt}\n\n${imageReferences}`;
    }

    const { response: responseText, warning, cost, duration } = await runAutonomousCli({
      prompt,
      cwd: workingDir,
      aiPlatform: card.aiPlatform,
      label: "Generate",
      // Documents built through a skill's scripts take longer than a fix.
      timeoutMs: 15 * 60 * 1000,
      contract: RUN_OUTPUT_CONTRACTS.generate,
      tracking: {
        processKey,
        cardId: id,
        cardTitle: card.title,
        displayId,
        processType: "generate",
      },
    });

    // save_output wrote straight to the DB while the run went on; the row
    // read at the top of this handler predates it.
    const after = db
      .select({ outputPaths: schema.cards.outputPaths })
      .from(schema.cards)
      .where(eq(schema.cards.id, id))
      .get();
    const produced = freshOutputs(workingDir, parseOutputPaths(after?.outputPaths ?? null), startedAtMs);

    const { summary: summaryText, checklist: checklistText } = splitGenerateResponse(responseText);
    const summaryHtml = linkCardsInHtml(
      convertToTipTapTaskList(await marked(summaryText ?? responseText)),
      card.projectId
    );

    if (produced.length === 0) {
      const reason = APP_UPDATE_HINT.test(responseText)
        ? "save_output asked for an Ideafy app update, so no file was recorded. Update the app, then run Generate again."
        : "Generate finished without recording a file with save_output, so the card stays where it is. The summary below is what the run said it did — check it for a failed script.";
      // The run's own account goes above whatever plan the card had, which
      // stays: a failed run is no reason to lose it.
      const previous = card.solutionSummary?.trim() ? `<hr>${card.solutionSummary}` : "";
      const solutionSummary = prependWarningHtml(summaryHtml, reason) + previous;
      const updatedAt = new Date().toISOString();
      db.update(schema.cards)
        .set({ solutionSummary, processingType: null, updatedAt })
        .where(eq(schema.cards.id, id))
        .run();
      completeProcess(processKey, "completed", { warning: reason });
      return NextResponse.json(
        { error: reason, noOutput: true, solutionSummary, newStatus: card.status, updatedAt },
        { status: 422 }
      );
    }

    let solutionSummary = summaryHtml;
    if (warning) {
      solutionSummary = prependWarningHtml(solutionSummary, warning);
    }

    // A checklist the run left out still has to open with a core heading in
    // the card's language, and still has to point at the real file.
    const files = produced.map((p) => `\`${p}\``).join(", ");
    const fallbackChecklist =
      detectCardLanguage({ title: card.title, description: card.description }) === "tr"
        ? `## Temel akış\n- [ ] ${files} dosyasını aç, kartın istediği içeriğin orada olduğunu gör.\n- [ ] Rakamları, isimleri ve tonu bir kez gözden geçir.`
        : `## Core flow\n- [ ] Open ${files} and confirm it holds what the card asked for.\n- [ ] Read it through once for figures, names and tone.`;
    const testScenarios = convertToTipTapTaskList(await marked(checklistText ?? fallbackChecklist));

    const newStatus: Status = "test";
    const updatedAt = new Date().toISOString();
    db.update(schema.cards)
      .set({ status: newStatus, solutionSummary, testScenarios, updatedAt, processingType: null })
      .where(eq(schema.cards.id, id))
      .run();

    completeProcess(processKey, "completed", { warning });

    return NextResponse.json({
      success: true,
      cardId: id,
      newStatus,
      solutionSummary,
      testScenarios,
      outputPaths: produced,
      outputWarning: warning,
      cost,
      duration,
    });
  } catch (error) {
    console.error("Generate error:", error);
    db.update(schema.cards).set({ processingType: null }).where(eq(schema.cards.id, id)).run();
    completeProcess(processKey, "failed", { error: describeRunError(error) });
    if (isMissingDependencyError(error)) {
      return NextResponse.json({ error: error.message, dependency: error.binaryName }, { status: 400 });
    }
    return NextResponse.json(
      {
        error: "Failed to run Generate",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * The recorded outputs that are real files under the project folder and were
 * written since `sinceMs`. A path recorded by an earlier run and left alone
 * this time does not count — otherwise a re-run that failed outright would
 * still pass on its predecessor's file.
 */
function freshOutputs(projectFolder: string, recorded: string[] | null, sinceMs: number): string[] {
  if (!recorded?.length) return [];
  let root: string;
  try {
    root = realpathSync(projectFolder);
  } catch {
    return [];
  }
  return recorded.filter((relativePath) => {
    try {
      const real = realpathSync(path.resolve(root, relativePath));
      if (!real.startsWith(root + path.sep)) return false;
      const stat = statSync(real);
      return stat.isFile() && stat.mtimeMs >= sinceMs;
    } catch {
      return false;
    }
  });
}
