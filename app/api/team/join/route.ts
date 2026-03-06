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
  const inviteCode = body.inviteCode?.trim()?.toUpperCase();
  if (!inviteCode) {
    return NextResponse.json({ error: "Invite code is required" }, { status: 400 });
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

  // Find team by invite code
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
