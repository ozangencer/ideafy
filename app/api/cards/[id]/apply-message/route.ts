import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
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
import { persistArtifacts as persistArtifactFiles } from "@/lib/artifact-links";
import { getCardImageDir } from "@/lib/prompts";

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
  // opening after macOS cleans the temp dir.
  const persistArtifacts = (html: string) =>
    html.includes("file://") ? persistArtifactFiles(html, getCardImageDir(id)) : html;

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
  // a plan" moment) bumps a still-planning card into In Progress, mirroring
  // the side-effect that save_plan used to provide. Skip when the card is
  // already past planning so we don't bounce a finished card back.
  if (field === "solutionSummary" && ["ideation", "backlog", "bugs"].includes(existing.status)) {
    updates.status = "progress";
  }

  // Verdict parsing: applying an Opinion populates aiVerdict from the
  // "## Summary Verdict (...)" line in the markdown content. Mirrors the
  // verdict-derivation save_opinion used to do server-side. Leaves verdict
  // untouched when the content has no recognizable verdict line.
  if (field === "aiOpinion") {
    const verdict = parseVerdict(content);
    if (verdict) updates.aiVerdict = verdict;
  }

  db.update(schema.cards).set(updates).where(eq(schema.cards.id, id)).run();

  recordApplyMessage(id, existing.projectId ?? null, field, mode);

  return NextResponse.json({
    success: true,
    field,
    mode,
    label: FIELD_LABEL[field],
    statusChangedTo: updates.status,
    verdictSet: updates.aiVerdict,
    added,
  });
}

/**
 * Extract verdict from "## Summary Verdict (Strong Yes/Yes/Maybe/No/Strong No)"
 * style markdown headings. Maps Strong Yes/Yes → positive, No/Strong No →
 * negative. "Maybe" alone is ambiguous (depends on score) so we leave it null;
 * the user can flip the verdict manually if they want.
 */
function parseVerdict(markdown: string): "positive" | "negative" | null {
  const headingMatch = markdown.match(/##\s*Summary\s*Verdict[^\n]*/i);
  const line = headingMatch?.[0] ?? "";
  if (/strong\s*yes|(^|[^a-z])yes([^a-z]|$)/i.test(line)) return "positive";
  if (/strong\s*no|(^|[^a-z])no([^a-z]|$)/i.test(line)) return "negative";
  return null;
}
