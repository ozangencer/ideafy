import { NextRequest, NextResponse } from "next/server";
import { testsChatWriteBlock } from "@/lib/autonomous-run/run-queue";

/**
 * GET: why a Tests chat turn on this card would start read-only right now, or
 * `{ block: null }`. The same check the chat runs when a message is sent, so
 * the notice above the input says what the next turn will do.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return NextResponse.json({ block: testsChatWriteBlock(id) });
}
