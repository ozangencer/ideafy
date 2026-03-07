import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getAuthenticatedUser } from "@/lib/team/server";

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
    return NextResponse.json({ members: [] });
  }

  const { data: members, error: membersError } = await supabase
    .from("team_members")
    .select("*")
    .eq("team_id", membership.team_id)
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

export async function DELETE(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request.headers.get("Authorization"));
  if (authError || !user) {
    return NextResponse.json({ error: authError || "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin()!;

  // Find user's current membership
  const { data: membership } = await supabase
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Not a member of any team" }, { status: 404 });
  }

  const { team_id, role } = membership;

  // Remove the user from the team
  const { error } = await supabase
    .from("team_members")
    .delete()
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Check remaining members
  const { data: remaining, error: countError } = await supabase
    .from("team_members")
    .select("id, user_id, joined_at")
    .eq("team_id", team_id)
    .order("joined_at", { ascending: true });

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }

  if (!remaining || remaining.length === 0) {
    // No members left — delete the team (pool_cards cascade-deleted)
    await supabase.from("teams").delete().eq("id", team_id);
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
