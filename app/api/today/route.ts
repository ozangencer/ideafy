import { NextRequest, NextResponse } from "next/server";

import { listTodayActivity } from "@/lib/today-registry";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

// `since` is the client's local midnight, sent as ISO. The server cannot know
// the user's timezone, so without it the fallback is the last 24 hours — work
// done at 03:00 still counts as today rather than landing in yesterday.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sinceParam = searchParams.get("since");
  const projectId = searchParams.get("projectId") || null;

  const parsed = sinceParam ? Date.parse(sinceParam) : NaN;
  const since = new Date(Number.isNaN(parsed) ? Date.now() - DAY_MS : parsed).toISOString();

  return NextResponse.json({ since, cards: listTodayActivity({ since, projectId }) });
}
