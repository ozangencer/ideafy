import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getAuthenticatedUser } from "@/lib/team/server";

export async function GET(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request.headers.get("Authorization"));
  if (authError || !user) {
    return NextResponse.json({ error: authError || "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin()!;
  const teamId = request.nextUrl.searchParams.get("teamId");

  if (!teamId) {
    return NextResponse.json({ members: [] });
  }

  // Verify user is a member of this team
  const { data: membership } = await supabase
    .from("team_members")
    .select("id")
    .eq("user_id", user.id)
    .eq("team_id", teamId)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this team" }, { status: 403 });
  }

  const { data: members, error: membersError } = await supabase
    .from("team_members")
    .select("*")
    .eq("team_id", teamId)
    .order("joined_at", { ascending: true });

  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 500 });
  }

  return NextResponse.json({
    members: (members || []).map((m) => ({
      id: m.id,
      teamId: m.team_id,
      userId: m.user_id,
      displayName: m.display_name,
      role: m.role,
      joinedAt: m.joined_at,
    })),
  });
}

export async function PATCH(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request.headers.get("Authorization"));
  if (authError || !user) {
    return NextResponse.json({ error: authError || "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin()!;
  const body = await request.json();
  const { teamId, targetUserId, newRole } = body;

  if (!teamId || !targetUserId || !newRole) {
    return NextResponse.json({ error: "teamId, targetUserId, and newRole are required" }, { status: 400 });
  }

  if (newRole !== "admin" && newRole !== "member") {
    return NextResponse.json({ error: "newRole must be 'admin' or 'member'" }, { status: 400 });
  }

  // Verify actor is owner of this team
  const { data: actorMembership } = await supabase
    .from("team_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("team_id", teamId)
    .single();

  if (!actorMembership || actorMembership.role !== "owner") {
    return NextResponse.json({ error: "Only the team owner can change member roles" }, { status: 403 });
  }

  // Verify target exists in team and is not owner
  const { data: targetMembership } = await supabase
    .from("team_members")
    .select("role")
    .eq("user_id", targetUserId)
    .eq("team_id", teamId)
    .single();

  if (!targetMembership) {
    return NextResponse.json({ error: "Target user is not a member of this team" }, { status: 404 });
  }

  if (targetMembership.role === "owner") {
    return NextResponse.json({ error: "Cannot change the owner's role" }, { status: 403 });
  }

  const { error } = await supabase
    .from("team_members")
    .update({ role: newRole })
    .eq("user_id", targetUserId)
    .eq("team_id", teamId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request.headers.get("Authorization"));
  if (authError || !user) {
    return NextResponse.json({ error: authError || "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin()!;

  const body = await request.json();
  const { teamId } = body;

  if (!teamId) {
    return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  }

  // Find user's membership in the specific team
  const { data: membership } = await supabase
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", user.id)
    .eq("team_id", teamId)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this team" }, { status: 404 });
  }

  const { role } = membership;

  // Remove the user from this specific team
  const { error } = await supabase
    .from("team_members")
    .delete()
    .eq("user_id", user.id)
    .eq("team_id", teamId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Check remaining members
  const { data: remaining, error: countError } = await supabase
    .from("team_members")
    .select("id, user_id, joined_at")
    .eq("team_id", teamId)
    .order("joined_at", { ascending: true });

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }

  if (!remaining || remaining.length === 0) {
    // No members left — delete the team (pool_cards cascade-deleted)
    await supabase.from("teams").delete().eq("id", teamId);
    return NextResponse.json({ success: true, teamDeleted: true });
  }

  // If owner left, transfer ownership to earliest member
  if (role === "owner") {
    await supabase
      .from("team_members")
      .update({ role: "owner" })
      .eq("id", remaining[0].id);
  }

  return NextResponse.json({ success: true });
}
