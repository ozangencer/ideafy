import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getAuthenticatedUser } from "@/lib/team/server";

// GET: Resolve a user query (email, name, or partial name) to user ID(s)
export async function GET(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request.headers.get("Authorization"));
  if (authError || !user) {
    return NextResponse.json({ error: authError || "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin()!;
  const query = request.nextUrl.searchParams.get("q")?.trim();
  const teamId = request.nextUrl.searchParams.get("teamId");

  if (!query) {
    return NextResponse.json({ error: "q parameter is required" }, { status: 400 });
  }

  if (!teamId) {
    return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  }

  // Verify membership
  const { data: membership } = await supabase
    .from("team_members")
    .select("id")
    .eq("user_id", user.id)
    .eq("team_id", teamId)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this team" }, { status: 403 });
  }

  // Get all team members
  const { data: members, error: membersError } = await supabase
    .from("team_members")
    .select("user_id, display_name")
    .eq("team_id", teamId);

  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 500 });
  }

  if (!members || members.length === 0) {
    return NextResponse.json({ matches: [] });
  }

  const lowerQuery = query.toLowerCase();
  const isEmail = query.includes("@");

  // If query looks like an email, resolve via Supabase auth
  if (isEmail) {
    const { data: authData } = await supabase.auth.admin.getUserByEmail(query);
    if (authData?.user) {
      const member = members.find((m) => m.user_id === authData.user.id);
      if (member) {
        return NextResponse.json({
          matches: [{ userId: member.user_id, displayName: member.display_name, email: query }],
        });
      }
    }
    return NextResponse.json({ matches: [] });
  }

  // Match by display name
  const matches = members.filter((m) => {
    const name = (m.display_name || "").toLowerCase();

    // Name contains query (supports partial first name)
    if (name.includes(lowerQuery)) return true;

    // Query words all present in name (e.g. "ozan gencer" matches "Ozan Gencer")
    const queryWords = lowerQuery.split(/\s+/);
    if (queryWords.length > 1 && queryWords.every((w) => name.includes(w))) return true;

    return false;
  });

  // Enrich matches with email from auth (for display)
  const enriched = await Promise.all(
    matches.map(async (m) => {
      const { data: authData } = await supabase.auth.admin.getUserById(m.user_id);
      return {
        userId: m.user_id,
        displayName: m.display_name,
        email: authData?.user?.email || "",
      };
    })
  );

  return NextResponse.json({ matches: enriched });
}
