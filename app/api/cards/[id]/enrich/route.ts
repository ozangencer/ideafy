import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { EnrichInputError, runEnrich } from "@/lib/ai/run-enrich";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const currentValue: string = typeof body?.currentValue === "string" ? body.currentValue : "";

  const card = db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.id, id))
    .get();

  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  try {
    const result = await runEnrich({
      currentValue,
      projectId: card.projectId,
      aiPlatform: card.aiPlatform,
      fallbackFolderPath: card.projectFolder,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof EnrichInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[Enrich] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
