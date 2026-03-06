import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

function getSupabaseServer(authHeader: string | null) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  return createClient(url, anonKey, {
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
  });
}

// POST: Push local card updates to pool
export async function POST(request: NextRequest) {
  const supabase = getSupabaseServer(request.headers.get("Authorization"));
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { cardId } = body;

  if (!cardId) {
    return NextResponse.json({ error: "cardId is required" }, { status: 400 });
  }

  // Read local card
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

  // Update pool card in Supabase
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
      last_synced_at: now,
      updated_at: now,
    })
    .eq("id", localCard.poolCardId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, poolCardId: localCard.poolCardId });
}
