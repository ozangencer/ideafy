import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getAuthenticatedUser } from "@/lib/team/server";

// GET: Fetch all pool cards for a specific team
export async function GET(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request.headers.get("Authorization"));
  if (authError || !user) {
    return NextResponse.json({ error: authError || "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin()!;
  const teamId = request.nextUrl.searchParams.get("teamId");

  if (!teamId) {
    return NextResponse.json({ cards: [] });
  }

  // Resolve display names for a set of pool cards by querying team_members
  async function resolveNames(cards: Record<string, unknown>[]) {
    // Collect all unique user IDs from assigned_to, pushed_by, pulled_by
    const userIds = new Set<string>();
    for (const c of cards) {
      if (c.assigned_to) userIds.add(c.assigned_to as string);
      if (c.pushed_by) userIds.add(c.pushed_by as string);
      if (c.pulled_by) userIds.add(c.pulled_by as string);
    }

    if (userIds.size === 0) return new Map<string, string>();

    const { data: members } = await supabase
      .from("team_members")
      .select("user_id, display_name")
      .in("user_id", Array.from(userIds));

    const nameMap = new Map<string, string>();
    for (const m of members || []) {
      if (!nameMap.has(m.user_id)) {
        nameMap.set(m.user_id, m.display_name);
      }
    }
    return nameMap;
  }

  // Helper to map a raw DB row to the API response shape
  const mapCard = (c: Record<string, unknown>, nameMap: Map<string, string>) => ({
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
    assignedToName: c.assigned_to ? nameMap.get(c.assigned_to as string) : undefined,
    pushedBy: c.pushed_by,
    pushedByName: c.pushed_by ? nameMap.get(c.pushed_by as string) : undefined,
    pulledBy: c.pulled_by,
    pulledByName: c.pulled_by ? nameMap.get(c.pulled_by as string) : undefined,
    projectName: c.project_name,
    sourceCardId: c.source_card_id,
    lastSyncedAt: c.last_synced_at,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  });

  // "all" → fetch pool cards from all teams the user is a member of
  if (teamId === "all") {
    const { data: memberships } = await supabase
      .from("team_members")
      .select("team_id, teams(name)")
      .eq("user_id", user.id);

    if (!memberships || memberships.length === 0) {
      return NextResponse.json({ cards: [] });
    }

    const teamIds = memberships.map((m) => m.team_id);
    const teamNameMap: Record<string, string> = {};
    for (const m of memberships) {
      const team = m.teams as unknown as { name: string } | null;
      teamNameMap[m.team_id] = team?.name || "Unknown";
    }

    const { data: cards, error: cardsError } = await supabase
      .from("pool_cards")
      .select("*")
      .in("team_id", teamIds)
      .order("updated_at", { ascending: false });

    if (cardsError) {
      return NextResponse.json({ error: cardsError.message }, { status: 500 });
    }

    const nameMap = await resolveNames(cards || []);

    return NextResponse.json({
      cards: (cards || []).map((c) => ({
        ...mapCard(c, nameMap),
        teamName: teamNameMap[c.team_id as string],
      })),
    });
  }

  // Single team: verify membership
  const { data: membership } = await supabase
    .from("team_members")
    .select("id")
    .eq("user_id", user.id)
    .eq("team_id", teamId)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this team" }, { status: 403 });
  }

  const { data: cards, error: cardsError } = await supabase
    .from("pool_cards")
    .select("*")
    .eq("team_id", teamId)
    .order("updated_at", { ascending: false });

  if (cardsError) {
    return NextResponse.json({ error: cardsError.message }, { status: 500 });
  }

  const nameMap = await resolveNames(cards || []);

  return NextResponse.json({
    cards: (cards || []).map((c) => mapCard(c, nameMap)),
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

  if (poolCard.pushed_by !== user.id && membership.role !== "owner" && membership.role !== "admin") {
    return NextResponse.json({ error: "Only the pusher, team owner, or admin can remove this card" }, { status: 403 });
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

  const body = await request.json();
  const { cardData, assignedTo, teamId } = body;

  if (!teamId) {
    return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  }

  // Verify membership in this team
  const { data: membership } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", user.id)
    .eq("team_id", teamId)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this team" }, { status: 403 });
  }

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
    project_name: cardData.projectName || null,
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

// PATCH: Claim/unclaim a pool card (assign to self or unassign)
export async function PATCH(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request.headers.get("Authorization"));
  if (authError || !user) {
    return NextResponse.json({ error: authError || "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin()!;
  const body = await request.json();
  const { poolCardId, action } = body;

  if (!poolCardId) {
    return NextResponse.json({ error: "poolCardId is required" }, { status: 400 });
  }

  // Get the pool card to verify team membership
  const { data: poolCard } = await supabase
    .from("pool_cards")
    .select("id, team_id, assigned_to")
    .eq("id", poolCardId)
    .single();

  if (!poolCard) {
    return NextResponse.json({ error: "Pool card not found" }, { status: 404 });
  }

  // Verify membership and get role
  const { data: membership } = await supabase
    .from("team_members")
    .select("id, role")
    .eq("user_id", user.id)
    .eq("team_id", poolCard.team_id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this team" }, { status: 403 });
  }

  // Block normal members from claiming cards assigned to others
  if (
    action === "claim" &&
    poolCard.assigned_to &&
    poolCard.assigned_to !== user.id &&
    membership.role !== "owner" &&
    membership.role !== "admin"
  ) {
    return NextResponse.json(
      { error: "Card is assigned to another member. Only admins can reassign." },
      { status: 403 }
    );
  }

  const assignedTo = action === "unclaim" ? null : user.id;

  const { error: updateError } = await supabase
    .from("pool_cards")
    .update({ assigned_to: assignedTo, updated_at: new Date().toISOString() })
    .eq("id", poolCardId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
