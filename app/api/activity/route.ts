import { NextRequest, NextResponse } from "next/server";

import {
  listActivity,
  markActivityRead,
  markActivityReadForCard,
  markActivitySeen,
  markAllActivityRead,
  pruneOldActivity,
} from "@/lib/activity-registry";

export const dynamic = "force-dynamic";

// Run retention once per server process, lazily on the first GET. Cheaper
// than a background interval and avoids touching db init during boot.
let prunedThisBoot = false;

export async function GET(request: NextRequest) {
  if (!prunedThisBoot) {
    prunedThisBoot = true;
    pruneOldActivity();
  }

  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  const unreadOnly = searchParams.get("unreadOnly") === "true";
  const projectIdParam = searchParams.get("projectId");

  const limit = limitParam ? Math.max(1, Math.min(200, parseInt(limitParam, 10) || 50)) : 50;
  const projectId =
    projectIdParam === null
      ? undefined
      : projectIdParam === "" || projectIdParam === "null"
      ? null
      : projectIdParam;

  const events = listActivity({ limit, unreadOnly, projectId });
  return NextResponse.json(events);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (body?.all === true) {
    markAllActivityRead();
    markActivitySeen(new Date().toISOString());
    return NextResponse.json({ success: true });
  }
  if (typeof body?.seenUpTo === "string" && !Number.isNaN(Date.parse(body.seenUpTo))) {
    const lastSeenAt = markActivitySeen(body.seenUpTo);
    return NextResponse.json({ success: true, lastSeenAt });
  }
  // Resolved server-side: the client list is capped at 50, so an older event
  // for this card may not be in it.
  if (typeof body?.cardId === "string" && body.cardId) {
    markActivityReadForCard(body.cardId);
    return NextResponse.json({ success: true });
  }
  if (Array.isArray(body?.ids) && body.ids.length > 0) {
    markActivityRead(body.ids.filter((v: unknown): v is string => typeof v === "string"));
    return NextResponse.json({ success: true });
  }
  return NextResponse.json({ error: "Provide ids[], cardId, seenUpTo or all=true" }, { status: 400 });
}
