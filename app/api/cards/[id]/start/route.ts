import { NextRequest, NextResponse } from "next/server";
import { startCardRun } from "@/lib/autonomous-run/start-card-run";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await startCardRun(id);
  return NextResponse.json(result.body, { status: result.status });
}
