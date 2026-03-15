import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getAuthenticatedUser } from "@/lib/team/server";

// POST: Clear pulled_by on a pool card (when local copy is deleted)
export async function POST(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request.headers.get("Authorization"));
  if (authError || !user) {
    return NextResponse.json({ error: authError || "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin()!;
  const body = await request.json();
  const { poolCardId } = body;

  if (!poolCardId) {
    return NextResponse.json({ error: "poolCardId is required" }, { status: 400 });
  }

  // Only allow the user who pulled it to unpull
  const { data: poolCard } = await supabase
    .from("pool_cards")
    .select("id, pulled_by")
    .eq("id", poolCardId)
    .single();

  if (!poolCard) {
    return NextResponse.json({ success: true }); // Already gone
  }

  if (poolCard.pulled_by !== user.id) {
    return NextResponse.json({ error: "Only the puller can unpull" }, { status: 403 });
  }

  const { error: updateError } = await supabase
    .from("pool_cards")
    .update({ pulled_by: null })
    .eq("id", poolCardId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
