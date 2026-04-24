import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  ensureHtml,
  markdownToTiptapHtml,
  mergeTestCheckState,
  testScenariosToMarkdown,
} from "@/lib/markdown";

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
 * markdown so the concatenated payload survives markdownToTiptapHtml +
 * mergeTestCheckState, preserving checkbox states on already-checked items.
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

  let nextHtml: string;
  if (mode === "replace") {
    nextHtml = ensureHtml(content);
  } else {
    // Append: reconstruct a markdown payload that represents existing + new,
    // then convert once so formatting stays consistent.
    if (field === "testScenarios") {
      const existingMd = testScenariosToMarkdown(existing.testScenarios || "");
      const combined = existingMd
        ? `${existingMd}\n\n${content}`
        : content;
      nextHtml = markdownToTiptapHtml(combined);
    } else {
      const existingHtml = (existing as Record<string, string | null>)[field] || "";
      const appendedHtml = markdownToTiptapHtml(content);
      nextHtml = existingHtml
        ? `${existingHtml}\n${appendedHtml}`
        : appendedHtml;
    }
  }

  if (field === "testScenarios" && existing.testScenarios) {
    nextHtml = mergeTestCheckState(existing.testScenarios, nextHtml);
  }

  const now = new Date().toISOString();
  db.update(schema.cards)
    .set({ [field]: nextHtml, updatedAt: now })
    .where(eq(schema.cards.id, id))
    .run();

  return NextResponse.json({
    success: true,
    field,
    mode,
    label: FIELD_LABEL[field],
  });
}
