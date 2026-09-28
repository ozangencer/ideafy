import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { placeAfter } from "@/lib/card-group";

class OrderError extends Error {}

/**
 * Moves one card within its chain: `{ cardId, afterCardId }`, where a null
 * `afterCardId` means "to the start".
 *
 * Every member gets a fresh 1..N, finished ones included, computed from the
 * rows as they are inside the transaction — so two tabs racing each other
 * still leave one consistent order, whichever wrote last.
 *
 * `updatedAt` is left alone on purpose: the Stale row measures age from it,
 * and reordering a chain is not work on any of its cards.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const cardId = typeof body.cardId === "string" ? body.cardId : null;
  const afterCardId = typeof body.afterCardId === "string" ? body.afterCardId : null;

  if (!cardId) {
    return NextResponse.json({ error: "cardId is required" }, { status: 400 });
  }
  if (afterCardId === cardId) {
    return NextResponse.json(
      { error: "A card cannot be placed after itself" },
      { status: 400 }
    );
  }

  const group = db
    .select({ id: schema.cardGroups.id })
    .from(schema.cardGroups)
    .where(eq(schema.cardGroups.id, id))
    .get();
  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  try {
    const order = db.transaction((tx) => {
      const members = tx
        .select({
          id: schema.cards.id,
          groupOrder: schema.cards.groupOrder,
          taskNumber: schema.cards.taskNumber,
        })
        .from(schema.cards)
        .where(eq(schema.cards.groupId, id))
        .all();

      const memberIds = new Set(members.map((member) => member.id));
      if (!memberIds.has(cardId)) {
        throw new OrderError("Card is not in this group");
      }
      if (afterCardId !== null && !memberIds.has(afterCardId)) {
        throw new OrderError("afterCardId is not in this group");
      }

      const ids = placeAfter(members, cardId, afterCardId);
      ids.forEach((memberId, index) => {
        tx.update(schema.cards)
          .set({ groupOrder: index + 1 })
          .where(eq(schema.cards.id, memberId))
          .run();
      });
      return ids.map((memberId, index) => ({ id: memberId, groupOrder: index + 1 }));
    });

    return NextResponse.json({ order });
  } catch (err) {
    if (err instanceof OrderError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[card-groups] Failed to reorder chain:", err);
    return NextResponse.json({ error: "Failed to reorder chain" }, { status: 500 });
  }
}
