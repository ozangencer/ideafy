import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getAuthenticatedUser } from "@/lib/team/server";

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// GET: Get current user's teams
export async function GET(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request.headers.get("Authorization"));
  if (authError || !user) {
    return NextResponse.json({ error: authError || "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin()!;

  const { data: memberships } = await supabase
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", user.id);

  if (!memberships || memberships.length === 0) {
    return NextResponse.json({ teams: [] });
  }

  const teamIds = memberships.map((m) => m.team_id);
  const { data: teams } = await supabase
    .from("teams")
    .select("*")
    .in("id", teamIds);

  if (!teams || teams.length === 0) {
    return NextResponse.json({ teams: [] });
  }

  return NextResponse.json({
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      inviteCode: team.invite_code,
      createdBy: team.created_by,
      createdAt: team.created_at,
    })),
  });
}

// POST: Create a new team
export async function POST(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request.headers.get("Authorization"));
  if (authError || !user) {
    return NextResponse.json({ error: authError || "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin()!;

  const body = await request.json();
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "Team name is required" }, { status: 400 });
  }

  const inviteCode = generateInviteCode();

  const { data: team, error: teamError } = await supabase
    .from("teams")
    .insert({ name, invite_code: inviteCode, created_by: user.id })
    .select()
    .single();

  if (teamError || !team) {
    return NextResponse.json({ error: teamError?.message || "Failed to create team" }, { status: 500 });
  }

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
