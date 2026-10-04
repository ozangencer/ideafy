import { NextRequest, NextResponse } from "next/server";
import { sqlite } from "@/lib/db";
import { getGroup, moveCardInChain } from "@/lib/card-ops";
import { cardGroupErrorResponse } from "../../error-response";

/**
 * Moves one card within its chain: `{ cardId, afterCardId }`, where a null
 * `afterCardId` means "to the start".
 *
 * lib/card-ops' moveCardInChain, the same one update_card's afterCardId runs:
 * every member gets a fresh 1..N inside one transaction, and a move that
 * leaves the chain as it was writes nothing. `order` is the chain as it now
 * stands either way, so the board can take the server's answer over its
 * guess.
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

  try {
    const db = sqlite();
    if (!getGroup(db, id)) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }
    const { order } = moveCardInChain(db, cardId, afterCardId, id);
    return NextResponse.json({ order });
  } catch (err) {
    return cardGroupErrorResponse(err, "Failed to reorder chain");
  }
}
