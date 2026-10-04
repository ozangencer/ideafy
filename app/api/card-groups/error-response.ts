import { NextResponse } from "next/server";
import { CardGroupError } from "@/lib/card-ops";

const STATUS = { not_found: 404, invalid: 400, conflict: 409 } as const;

/**
 * The HTTP answer for a group rule lib/card-ops refused — 404, 400 or 409 by
 * the error's kind, with the same message the MCP shows. Anything else is a
 * real failure: logged, and a 500 with `fallback`.
 */
export function cardGroupErrorResponse(err: unknown, fallback: string): NextResponse {
  if (err instanceof CardGroupError) {
    return NextResponse.json({ error: err.message }, { status: STATUS[err.kind] });
  }
  console.error(`[card-groups] ${fallback}:`, err);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
