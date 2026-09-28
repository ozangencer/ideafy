import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const existing = db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.id, id))
    .get();

  if (!existing) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  // Clear processing state. The timestamp goes back in the response so the
  // client's copy matches the server's; a made-up one turns the open form's
  // next auto-save into a stale write.
  const updatedAt = new Date().toISOString();
  db.update(schema.cards)
    .set({
      processingType: null,
      updatedAt,
    })
    .where(eq(schema.cards.id, id))
    .run();

  return NextResponse.json({
    success: true,
    message: "Processing state cleared",
    cardId: id,
    updatedAt,
  });
}
