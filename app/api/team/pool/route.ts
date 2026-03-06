import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

// GET: Fetch all pool cards for user's team
export async function GET(request: NextRequest) {
  const supabase = getSupabaseServer(request.headers.get("Authorization"));
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find user's team
  const { data: membership } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ cards: [] });
  }

  // Get all pool cards + member names
  const { data: cards, error: cardsError } = await supabase
    .from("pool_cards")
    .select(`
      *,
      assignee:team_members!pool_cards_assigned_to_fkey(display_name),
      pusher:team_members!pool_cards_pushed_by_fkey(display_name)
    `)
    .eq("team_id", membership.team_id)
    .order("updated_at", { ascending: false });

  if (cardsError) {
    // Fallback: query without joins if foreign key names don't match
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
      sourceCardId: c.source_card_id,
      lastSyncedAt: c.last_synced_at,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    })),
  });
}

// POST: Send card to pool (upsert)
export async function POST(request: NextRequest) {
  const supabase = getSupabaseServer(request.headers.get("Authorization"));
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find user's team
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

  // Check if pool card already exists for this source card
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
    // Update existing
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
    // Create new
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
