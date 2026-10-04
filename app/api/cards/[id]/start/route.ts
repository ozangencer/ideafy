import { NextRequest, NextResponse } from "next/server";
import { startCardRun } from "@/lib/autonomous-run/start-card-run";
import { isVerifyScope } from "@/lib/test-progress";

/** `{ verifyScope? }` — on a Human Test card, `"all"` walks every group left. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const verifyScope = isVerifyScope(body.verifyScope) ? body.verifyScope : undefined;
  const result = await startCardRun(id, { verifyScope });
  return NextResponse.json(result.body, { status: result.status });
}
