import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getSupabaseAdmin, getAuthenticatedUser } from "@/lib/team/server";

// POST: Push local card updates to pool
export async function POST(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request.headers.get("Authorization"));
  if (authError || !user) {
    return NextResponse.json({ error: authError || "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin()!;

  const body = await request.json();
  const { cardId } = body;

  if (!cardId) {
    return NextResponse.json({ error: "cardId is required" }, { status: 400 });
  }

  const localCard = db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.id, cardId))
    .get();

  if (!localCard) {
    return NextResponse.json({ error: "Local card not found" }, { status: 404 });
  }

  if (!localCard.poolCardId) {
    return NextResponse.json({ error: "Card is not linked to pool" }, { status: 400 });
  }

  const now = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("pool_cards")
    .update({
      title: localCard.title,
      description: localCard.description || null,
      solution_summary: localCard.solutionSummary || null,
      test_scenarios: localCard.testScenarios || null,
      ai_opinion: localCard.aiOpinion || null,
      ai_verdict: localCard.aiVerdict || null,
      status: localCard.status,
      complexity: localCard.complexity,
      priority: localCard.priority,
      assigned_to: localCard.assignedTo || null,
      last_synced_at: now,
      updated_at: now,
    })
    .eq("id", localCard.poolCardId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, poolCardId: localCard.poolCardId });
}
