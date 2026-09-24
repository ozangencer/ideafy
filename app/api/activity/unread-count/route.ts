import { NextRequest, NextResponse } from "next/server";

import {
  getActivityLastSeenAt,
  unreadActivityCount,
  unseenActivityCount,
} from "@/lib/activity-registry";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const projectIdParam = searchParams.get("projectId");
  const projectId =
    projectIdParam === null
      ? undefined
      : projectIdParam === "" || projectIdParam === "null"
      ? null
      : projectIdParam;
  const count = unreadActivityCount(projectId);
  const unseenCount = unseenActivityCount(projectId);
  return NextResponse.json({ count, unseenCount, lastSeenAt: getActivityLastSeenAt() });
}
