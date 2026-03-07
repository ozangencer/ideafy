import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getAuthenticatedUser } from "@/lib/team/server";

// GET: Fetch all pool cards for user's team
export async function GET(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request.headers.get("Authorization"));
  if (authError || !user) {
    return NextResponse.json({ error: authError || "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin()!;

  const { data: membership } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ cards: [] });
  }

  const { data: cards, error: cardsError } = await supabase
    .from("pool_cards")
    .select(`
      *,
      assignee:team_members!pool_cards_assigned_to_fkey(display_name),
      pusher:team_members!pool_cards_pushed_by_fkey(display_name),
      puller:team_members!pool_cards_pulled_by_fkey(display_name)
    `)
    .eq("team_id", membership.team_id)
    .order("updated_at", { ascending: false });

  if (cardsError) {
    // Fallback without joins
    const { data: fallbackCards, error: fallbackError } = await supabase
      .from("pool_cards")
      .select("*")
      .eq("team_id", membership.team_id)
      .order("updated_at", { ascending: false });

    if (fallbackError) {
      return NextResponse.json({ error: fallbackError.message }, { status: 500 });
    }

    return NextResponse.json({
      cards: (fallbackCards || []).map((c) => ({
        id: c.id,
        teamId: c.team_id,
        title: c.title,
        description: c.description,
        solutionSummary: c.solution_summary,
        testScenarios: c.test_scenarios,
        aiOpinion: c.ai_opinion,
        aiVerdict: c.ai_verdict,
        status: c.status,
        complexity: c.complexity,
        priority: c.priority,
        assignedTo: c.assigned_to,
        pushedBy: c.pushed_by,
        pulledBy: c.pulled_by,
        sourceCardId: c.source_card_id,
        lastSyncedAt: c.last_synced_at,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      })),
    });
  }

  return NextResponse.json({
    cards: (cards || []).map((c) => ({
      id: c.id,
      teamId: c.team_id,
      title: c.title,
      description: c.description,
      solutionSummary: c.solution_summary,
      testScenarios: c.test_scenarios,
      aiOpinion: c.ai_opinion,
      aiVerdict: c.ai_verdict,
      status: c.status,
      complexity: c.complexity,
      priority: c.priority,
      assignedTo: c.assigned_to,
      assignedToName: c.assignee?.[0]?.display_name,
      pushedBy: c.pushed_by,
      pushedByName: c.pusher?.[0]?.display_name,
      pulledBy: c.pulled_by,
      pulledByName: c.puller?.[0]?.display_name,
      sourceCardId: c.source_card_id,
      lastSyncedAt: c.last_synced_at,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    })),
  });
}

// DELETE: Remove card from pool
export async function DELETE(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request.headers.get("Authorization"));
  if (authError || !user) {
    return NextResponse.json({ error: authError || "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin()!;
  const body = await request.json();
  const { poolCardId } = body;

  if (!poolCardId) {
    return NextResponse.json({ error: "poolCardId is required" }, { status: 400 });
  }

  // Check if card exists
  const { data: poolCard } = await supabase
    .from("pool_cards")
    .select("id, pushed_by, team_id")
    .eq("id", poolCardId)
    .single();

  // Idempotent: already deleted → success
  if (!poolCard) {
    return NextResponse.json({ success: true });
  }

  // Authorization: only the pusher or team owner can delete
  const { data: membership } = await supabase
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", user.id)
    .eq("team_id", poolCard.team_id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Not in this team" }, { status: 403 });
  }

  if (poolCard.pushed_by !== user.id && membership.role !== "owner") {
    return NextResponse.json({ error: "Only the pusher or team owner can remove this card" }, { status: 403 });
  }

  const { error: deleteError } = await supabase
    .from("pool_cards")
    .delete()
    .eq("id", poolCardId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// POST: Send card to pool (upsert)
export async function POST(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request.headers.get("Authorization"));
  if (authError || !user) {
    return NextResponse.json({ error: authError || "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin()!;

  const { data: membership } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Not in a team" }, { status: 400 });
  }

  const body = await request.json();
  const { cardData, assignedTo } = body;

  if (!cardData?.title) {
    return NextResponse.json({ error: "Card title is required" }, { status: 400 });
  }

  const now = new Date().toISOString();

  let existingPoolCard = null;
  if (cardData.sourceCardId) {
    const { data } = await supabase
      .from("pool_cards")
      .select("id")
      .eq("source_card_id", cardData.sourceCardId)
      .eq("team_id", membership.team_id)
      .single();
    existingPoolCard = data;
  }

  const poolCardData = {
    team_id: membership.team_id,
    title: cardData.title,
    description: cardData.description || null,
    solution_summary: cardData.solutionSummary || null,
    test_scenarios: cardData.testScenarios || null,
    ai_opinion: cardData.aiOpinion || null,
    ai_verdict: cardData.aiVerdict || null,
    status: cardData.status || "backlog",
    complexity: cardData.complexity || "medium",
    priority: cardData.priority || "medium",
    assigned_to: assignedTo || null,
    pushed_by: user.id,
    source_card_id: cardData.sourceCardId || null,
    last_synced_at: now,
    updated_at: now,
  };

  if (existingPoolCard) {
    const { data: updated, error } = await supabase
      .from("pool_cards")
      .update(poolCardData)
      .eq("id", existingPoolCard.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ poolCardId: updated.id });
  } else {
    const { data: created, error } = await supabase
      .from("pool_cards")
      .insert({ ...poolCardData, created_at: now })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ poolCardId: created.id }, { status: 201 });
  }
}
