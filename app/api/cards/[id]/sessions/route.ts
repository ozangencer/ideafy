import { NextResponse } from "next/server";
import { listCardSessionsWithCommands } from "@/lib/card-sessions";

// Every CLI session recorded for this card — both the ones Ideafy started
// itself and the ones the user started in their own terminal — newest first,
// each with a paste-ready resume command.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: cardId } = await params;

  try {
    return NextResponse.json({ sessions: listCardSessionsWithCommands(cardId) });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to list sessions",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
