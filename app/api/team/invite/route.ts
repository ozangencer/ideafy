import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getAuthenticatedUser } from "@/lib/team/server";
import { sendTeamInviteEmail } from "@/lib/team/email";

export async function POST(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request.headers.get("Authorization"));
  if (authError || !user) {
    return NextResponse.json({ error: authError || "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const email = body.email?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin()!;

  // Get user's team membership
  const { data: membership } = await supabase
    .from("team_members")
    .select("team_id, display_name")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "You are not a member of any team" }, { status: 404 });
  }

  // Get team details
  const { data: team } = await supabase
    .from("teams")
    .select("name, invite_code")
    .eq("id", membership.team_id)
    .single();

  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const result = await sendTeamInviteEmail(email, team.name, membership.display_name, team.invite_code);

  if (!result.success) {
    return NextResponse.json({ error: result.error || "Failed to send email" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
