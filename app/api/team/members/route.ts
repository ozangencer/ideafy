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
    return NextResponse.json({ members: [] });
  }

  // Get all team members
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

// DELETE: Leave team
export async function DELETE(request: NextRequest) {
  const supabase = getSupabaseServer(request.headers.get("Authorization"));
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("team_members")
    .delete()
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
