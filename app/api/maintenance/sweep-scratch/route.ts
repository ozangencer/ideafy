import { NextResponse } from "next/server";
import { homedir } from "os";
import { join } from "path";
import { db, schema } from "@/lib/db";
import { TRASH_RETENTION_MS } from "@/lib/card-trash";
import { sweepScratch } from "@/lib/scratch-sweep";

// POST /api/maintenance/sweep-scratch — clears scratch/ of cards completed
// over a week ago and removes folders of cards gone from both cards and
// card_trash. BackupScheduler calls it on launch and daily; any number of
// concurrent calls is safe.
export async function POST() {
  try {
    const cards = db
      .select({
        id: schema.cards.id,
        status: schema.cards.status,
        completedAt: schema.cards.completedAt,
        updatedAt: schema.cards.updatedAt,
      })
      .from(schema.cards)
      .all();
    const trashed = db.select({ cardId: schema.cardTrash.cardId }).from(schema.cardTrash).all();

    const result = sweepScratch({
      imagesRoot: join(homedir(), ".ideafy", "images"),
      cards,
      trashedCardIds: trashed.map((row) => row.cardId),
      retentionMs: TRASH_RETENTION_MS,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to sweep scratch folders:", error);
    return NextResponse.json({ error: "Failed to sweep scratch folders" }, { status: 500 });
  }
}
