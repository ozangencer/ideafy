import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabaseServer(authHeader: string | null) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const client = createClient(url, anonKey, {
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
  });
  return client;
}

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// GET: Get current user's team
export async function GET(request: NextRequest) {
  const supabase = getSupabaseServer(request.headers.get("Authorization"));
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find user's team membership
  const { data: membership, error: memberError } = await supabase
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", user.id)
    .single();

  if (memberError || !membership) {
    return NextResponse.json({ team: null });
  }

  // Get team details
  const { data: team, error: teamError } = await supabase
    .from("teams")
    .select("*")
    .eq("id", membership.team_id)
    .single();

  if (teamError || !team) {
    return NextResponse.json({ team: null });
  }

  return NextResponse.json({
    team: {
      id: team.id,
      name: team.name,
      inviteCode: team.invite_code,
      createdBy: team.created_by,
      createdAt: team.created_at,
    },
    role: membership.role,
  });
}

// POST: Create a new team
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
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "Team name is required" }, { status: 400 });
  }

  // Check if user is already in a team
  const { data: existing } = await supabase
    .from("team_members")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (existing) {
    return NextResponse.json({ error: "Already in a team. Leave first." }, { status: 409 });
  }

  const inviteCode = generateInviteCode();

  // Create team
  const { data: team, error: teamError } = await supabase
    .from("teams")
    .insert({ name, invite_code: inviteCode, created_by: user.id })
    .select()
    .single();

  if (teamError || !team) {
    return NextResponse.json({ error: teamError?.message || "Failed to create team" }, { status: 500 });
  }

  // Add creator as owner
  const displayName =
    user.user_metadata?.display_name ||
    user.user_metadata?.full_name ||
    user.email?.split("@")[0] ||
    "Owner";

  await supabase.from("team_members").insert({
    team_id: team.id,
    user_id: user.id,
    display_name: displayName,
    role: "owner",
  });

  return NextResponse.json({
    team: {
      id: team.id,
      name: team.name,
      inviteCode: team.invite_code,
      createdBy: team.created_by,
      createdAt: team.created_at,
    },
  }, { status: 201 });
}
