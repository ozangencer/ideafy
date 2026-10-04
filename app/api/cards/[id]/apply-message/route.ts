import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema, sqlite } from "@/lib/db";
import { linkCardsInHtml } from "@/lib/card-link-resolver";
import {
  ensureHtml,
  ensureTestScenariosHtml,
  markdownToTiptapHtml,
  mergeHtmlSections,
  mergeTestCheckState,
  mergeTestMarkdownSections,
  testScenariosToMarkdown,
} from "@/lib/markdown";
import { recordApplyMessage } from "@/lib/activity-registry";
import { saveOpinion, statusAfterPlan, type SavedOpinionFields } from "@/lib/card-ops";
import { persistCardArtifacts } from "@/lib/artifact-links";

type Field = "description" | "solutionSummary" | "aiOpinion" | "testScenarios";
type Mode = "replace" | "append";

const VALID_FIELDS: Field[] = ["description", "solutionSummary", "aiOpinion", "testScenarios"];

const FIELD_LABEL: Record<Field, string> = {
  description: "Detail",
  solutionSummary: "Solution",
  aiOpinion: "AI Opinion",
  testScenarios: "Tests",
};

/**
 * Apply an assistant chat message to a single card field in one of two modes:
 *   - replace: overwrite the field with the message content
 *   - append: preserve existing content and add the message content after it
 *
 * Append is field-aware: for testScenarios we round-trip existing HTML back to
 * markdown so the merged payload survives markdownToTiptapHtml +
 * mergeTestCheckState, preserving checkbox states on already-checked items.
 * Append is also heading-aware: a section the field already has gets the new
 * body inside it instead of a second copy of the heading, and blocks that are
 * already there are skipped. `added` in the response counts what was written;
 * 0 means nothing new, and the card is left untouched.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const field = body.field as Field | undefined;
  const mode = (body.mode as Mode | undefined) ?? "replace";
  const content = typeof body.content === "string" ? body.content : "";

  if (!field || !VALID_FIELDS.includes(field)) {
    return NextResponse.json({ error: `Invalid field: ${field}` }, { status: 400 });
  }
  if (mode !== "replace" && mode !== "append") {
    return NextResponse.json({ error: `Invalid mode: ${mode}` }, { status: 400 });
  }
  if (!content.trim()) {
    return NextResponse.json({ error: "Content is empty" }, { status: 400 });
  }

  const existing = db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.id, id))
    .get();
  if (!existing) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  // Plans and opinions name other cards as "IDE-318"; store them as [[ chips.
  const linkCards = (html: string) =>
    field === "solutionSummary" || field === "aiOpinion"
      ? linkCardsInHtml(html, existing.projectId)
      : html;

  // An approved artifact (mockup, image, doc) linked as file://… is copied
  // out of /var/folders or /tmp into the card's own folder so the chip keeps
  // opening after macOS cleans the temp dir. The MCP's save_opinion and
  // save_plan run the same pass.
  const persistArtifacts = (html: string) => persistCardArtifacts(html, id);

  let nextHtml: string;
  let added: number | undefined;
  if (mode === "replace") {
    nextHtml =
      field === "testScenarios"
        ? ensureTestScenariosHtml(content)
        : persistArtifacts(linkCards(ensureHtml(content)));
  } else {
    // Append: reconstruct a markdown payload that represents existing + new,
    // then convert once so formatting stays consistent.
    if (field === "testScenarios") {
      const existingMd = testScenariosToMarkdown(existing.testScenarios || "");
      const merged = mergeTestMarkdownSections(existingMd, content);
      added = merged.added;
      nextHtml = ensureTestScenariosHtml(merged.markdown);
    } else {
      const existingHtml = (existing as Record<string, string | null>)[field] || "";
      const merged = mergeHtmlSections(
        existingHtml,
        persistArtifacts(linkCards(markdownToTiptapHtml(content)))
      );
      added = merged.added;
      nextHtml = merged.html;
    }
  }

  if (added === 0) {
    return NextResponse.json({
      success: true,
      field,
      mode,
      label: FIELD_LABEL[field],
      added,
    });
  }

  if (field === "testScenarios" && existing.testScenarios) {
    nextHtml = mergeTestCheckState(existing.testScenarios, nextHtml);
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { [field]: nextHtml, updatedAt: now };

  // Status auto-transition: applying a Solution plan (the canonical "I have
  // a plan" moment) bumps a still-planning card into In Progress. Which
  // columns move is lib/card-ops' statusAfterPlan — the rule the MCP's
  // save_plan uses — so a finished card is not bounced back on either path.
  const planStatus = field === "solutionSummary" ? statusAfterPlan(existing.status) : null;
  if (planStatus) {
    updates.status = planStatus;
  }

  // An Opinion goes through lib/card-ops' saveOpinion — the write Evaluate and
  // the MCP save_opinion make — so its verdict, score, priority and complexity
  // land the same whichever path wrote it. In append mode only the added part
  // is read: a fragment that names no verdict or score keeps the card's own.
  let opinion: SavedOpinionFields | null = null;
  if (field === "aiOpinion") {
    const saved = saveOpinion(sqlite(), {
      id,
      html: nextHtml,
      source: content,
      mode,
      now,
    });
    if (!saved.ok) {
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    }
    opinion = saved;
  } else {
    db.update(schema.cards).set(updates).where(eq(schema.cards.id, id)).run();
  }

  recordApplyMessage(id, existing.projectId ?? null, field, mode);

  return NextResponse.json({
    success: true,
    field,
    mode,
    label: FIELD_LABEL[field],
    statusChangedTo: updates.status,
    verdictSet: opinion?.verdict ?? undefined,
    scoreSet: opinion?.score ?? undefined,
    added,
  });
}
