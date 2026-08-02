import { NextResponse } from "next/server";
import { listCmuxWorkspaces } from "@/lib/terminal/cmux";

// The list reflects whatever cmux has open right now, so it must not be cached.
export const dynamic = "force-dynamic";

// GET /api/cmux/workspaces - Workspaces cmux currently has open.
// Returns an empty list rather than an error when cmux is not installed or not
// running: the picker that consumes this is optional configuration, and
// opening project settings should never boot the terminal.
export async function GET() {
  const workspaces = await listCmuxWorkspaces();
  return NextResponse.json({ workspaces });
}
