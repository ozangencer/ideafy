import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getAuthenticatedUser } from "@/lib/team/server";

export async function POST(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request.headers.get("Authorization"));
  if (authError || !user) {
    return NextResponse.json({ error: authError || "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin()!;

  const body = await request.json();
  const inviteCode = body.inviteCode?.trim()?.toUpperCase();
  if (!inviteCode) {
    return NextResponse.json({ error: "Invite code is required" }, { status: 400 });
  }

  const { data: team, error: teamError } = await supabase
    .from("teams")
    .select("*")
    .eq("invite_code", inviteCode)
    .single();

  if (teamError || !team) {
    return NextResponse.json({ error: "Invalid invite code" }, { status: 404 });
  }

  const displayName =
    user.user_metadata?.display_name ||
    user.user_metadata?.full_name ||
    user.email?.split("@")[0] ||
    "Member";

  const { error: joinError } = await supabase.from("team_members").insert({
    team_id: team.id,
    user_id: user.id,
    display_name: displayName,
    role: "member",
  });

  if (joinError) {
    // UNIQUE(team_id, user_id) constraint catches duplicate joins
    if (joinError.code === "23505") {
      return NextResponse.json({ error: "Already a member of this team" }, { status: 409 });
    }
    return NextResponse.json({ error: joinError.message }, { status: 500 });
  }

  return NextResponse.json({
    team: {
      id: team.id,
      name: team.name,
      inviteCode: team.invite_code,
      createdBy: team.created_by,
      createdAt: team.created_at,
    },
  });
}
