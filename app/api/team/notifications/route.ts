import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getAuthenticatedUser } from "@/lib/team/server";

// GET: Fetch notifications for current user (last 30 days)
export async function GET(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request.headers.get("Authorization"));
  if (authError || !user) {
    return NextResponse.json({ error: authError || "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin()!;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: notifications, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("recipient_user_id", user.id)
    .gte("created_at", thirtyDaysAgo)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    notifications: (notifications || []).map((n) => ({
      id: n.id,
      recipientUserId: n.recipient_user_id,
      teamId: n.team_id,
      type: n.type,
      title: n.title,
      message: n.message,
      referenceId: n.reference_id,
      actorUserId: n.actor_user_id,
      actorName: n.actor_name,
      isRead: n.is_read,
      createdAt: n.created_at,
    })),
  });
}

// POST: Create a notification
export async function POST(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request.headers.get("Authorization"));
  if (authError || !user) {
    return NextResponse.json({ error: authError || "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin()!;
  const body = await request.json();

  const { recipientUserId, teamId, type, title, message, referenceId } = body;

  if (!recipientUserId || !teamId || !title) {
    return NextResponse.json({ error: "recipientUserId, teamId, and title are required" }, { status: 400 });
  }

  // Don't create notification for self-assignment
  if (recipientUserId === user.id) {
    return NextResponse.json({ skipped: true });
  }

  // Get actor display name
  const { data: actorMember } = await supabase
    .from("team_members")
    .select("display_name")
    .eq("user_id", user.id)
    .eq("team_id", teamId)
    .single();

  const { data: notification, error } = await supabase
    .from("notifications")
    .insert({
      recipient_user_id: recipientUserId,
      team_id: teamId,
      type: type || "assignment",
      title,
      message: message || null,
      reference_id: referenceId || null,
      actor_user_id: user.id,
      actor_name: actorMember?.display_name || "Unknown",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ notification }, { status: 201 });
}

// PUT: Mark all notifications as read
export async function PUT(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request.headers.get("Authorization"));
  if (authError || !user) {
    return NextResponse.json({ error: authError || "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin()!;

  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("recipient_user_id", user.id)
    .eq("is_read", false);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
