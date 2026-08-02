import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// Claude Code PostToolUse hook endpoint for ExitPlanMode.
//
// Plan mode writes the approved plan to a file under ~/.claude/plans and
// nothing ever tells the card about it. A session bound to a card finishes
// planning, the plan lives in a markdown file nobody opens again, and the
// card's Solution tab stays empty — with no signal anywhere that the two came
// apart. It surfaces later as "why isn't the plan on the card", by which point
// the work has moved on.
//
// The phase policy cannot cover this. It fires on user prompts and knows only
// which column the card is in; it never learns that a plan was just produced.
// So this fires exactly once, at approval, and speaks only when the card really
// has no plan on it — a card that already has one gets silence, because a
// second nudge per plan is worse than none.
//
// Fail-open: any unexpected error returns 204 so a broken Ideafy install can
// never wedge plan mode.

function ok204() {
  return new Response(null, { status: 204 });
}

function context(message: string) {
  return new Response(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: message,
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

// Solution summaries are stored as Tiptap HTML, so "" is not the only empty.
// An untouched field can also be a lone empty paragraph.
function hasPlan(html: string | null | undefined): boolean {
  if (!html) return false;
  return (
    html
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim().length > 0
  );
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const toolName =
      typeof payload.tool_name === "string" ? payload.tool_name : "";
    if (toolName !== "ExitPlanMode") return ok204();

    const sessionId =
      typeof payload.session_id === "string" ? payload.session_id : "";
    if (!sessionId) return ok204();

    const session = db
      .select()
      .from(schema.ideafySessions)
      .where(eq(schema.ideafySessions.sessionId, sessionId))
      .get();

    if (!session || session.state !== "bound" || !session.cardId) {
      return ok204();
    }

    const card = db
      .select()
      .from(schema.cards)
      .where(eq(schema.cards.id, session.cardId))
      .get();

    if (!card) return ok204();
    if (hasPlan(card.solutionSummary)) return ok204();

    return context(
      `Ideafy: a plan was just approved, but card ${card.id} ("${card.title}") ` +
        `has an empty Solution tab — the plan currently exists only in the plan ` +
        `file, which nothing on the board can see. Ask the user whether to write ` +
        `it to the card with save_plan, and call the tool only on a clear yes. ` +
        `Note that save_plan also moves the card to In Progress, so say that when ` +
        `you ask if the card is not there yet (it is in "${card.status}").`
    );
  } catch (error) {
    console.error("[plan-sync-check] unexpected error", error);
    return ok204();
  }
}
