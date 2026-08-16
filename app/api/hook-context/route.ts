import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { promptLooksLikeCardRequest } from "@/lib/card-request-detection";
import {
  buildCreationOfferPolicy,
  buildPhasePolicy,
  isTerminalPhase,
  resolveEffectiveWorktree,
  resolveProjectByFolderAncestor,
} from "@/lib/hook-policy";

// Universal hook endpoint. The Claude Code UserPromptSubmit hook POSTs its
// input JSON here on every user turn. Behaviour depends on whether the
// session is fresh, already offered a card creation, or bound to a card.
//
// Query string:
//   ?card_hint=<id>  — optional. Legacy "Open in Terminal" flow sets the
//                      IDEAFY_CARD_ID env var; the hook command forwards it
//                      here. A fresh session with a hint auto-binds to that
//                      card, skipping the creation offer.
//
// Response:
//   200 text/plain — the hook echoes this into Claude's transcript.
//   204            — no output (project not recognised, or session is in
//                    "offered" state, or card is in a terminal column).
export async function POST(request: NextRequest) {
  let hookInput: Record<string, unknown> = {};
  try {
    hookInput = await request.json();
  } catch {
    return new Response(null, { status: 204 });
  }

  const sessionId =
    typeof hookInput.session_id === "string" ? hookInput.session_id : "";
  const cwd = typeof hookInput.cwd === "string" ? hookInput.cwd : "";
  // Claude Code sends the turn's text as `prompt`. Only the creation offer
  // reads it — a bound session's phase policy does not depend on wording.
  const prompt = typeof hookInput.prompt === "string" ? hookInput.prompt : "";

  if (!sessionId || !cwd) {
    return new Response(null, { status: 204 });
  }

  const project = resolveProjectByFolderAncestor(cwd);
  if (!project) {
    return new Response(null, { status: 204 });
  }

  const cardHint = request.nextUrl.searchParams.get("card_hint") || "";

  // Upsert the session row.
  const now = new Date().toISOString();
  let sessionRow = db
    .select()
    .from(schema.ideafySessions)
    .where(eq(schema.ideafySessions.sessionId, sessionId))
    .get();

  if (!sessionRow) {
    // Fresh session. If the legacy env var hint is present, auto-bind to
    // that card and fall through to bound-state handling. Otherwise, show
    // the creation offer exactly once.
    if (cardHint) {
      db.insert(schema.ideafySessions)
        .values({
          sessionId,
          projectId: project.id,
          state: "bound",
          cardId: cardHint,
          provider: "claude",
          cwd,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      sessionRow = {
        sessionId,
        projectId: project.id,
        state: "bound",
        cardId: cardHint,
        provider: "claude",
        cwd,
        createdAt: now,
        updatedAt: now,
      };
    } else {
      // Record cwd even in the "offered" state: the user may bind a card
      // later via bind_session_to_card, which has no cwd of its own to
      // supply. This row is the only place it gets captured.
      db.insert(schema.ideafySessions)
        .values({
          sessionId,
          projectId: project.id,
          state: "offered",
          cardId: null,
          provider: "claude",
          cwd,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      return new Response(
        buildCreationOfferPolicy(
          { id: project.id, name: project.name },
          { promptLooksLikeCardRequest: promptLooksLikeCardRequest(prompt) }
        ),
        {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }
      );
    }
  }

  if (sessionRow.state === "offered") {
    return new Response(null, { status: 204 });
  }

  // Bound state — look up the card and return the phase policy.
  if (sessionRow.state === "bound" && sessionRow.cardId) {
    // Touch the row on every turn so updatedAt reads as "last used" rather
    // than "bound at" — the session list sorts on it. This also backfills
    // cwd for sessions bound before the column existed.
    db.update(schema.ideafySessions)
      .set({ updatedAt: now, cwd })
      .where(eq(schema.ideafySessions.sessionId, sessionId))
      .run();

    const card = db
      .select()
      .from(schema.cards)
      .where(eq(schema.cards.id, sessionRow.cardId))
      .get();

    if (!card || isTerminalPhase(card.status)) {
      return new Response(null, { status: 204 });
    }

    const cardProject = card.projectId
      ? db
          .select()
          .from(schema.projects)
          .where(eq(schema.projects.id, card.projectId))
          .get()
      : null;

    const branchPolicy =
      card.status === "progress"
        ? resolveEffectiveWorktree(
            {
              useWorktree: card.useWorktree,
              gitBranchName: card.gitBranchName,
              taskNumber: card.taskNumber,
              title: card.title,
            },
            cardProject
              ? {
                  useWorktrees: cardProject.useWorktrees,
                  idPrefix: cardProject.idPrefix,
                }
              : null
          )
        : undefined;

    const body = buildPhasePolicy(
      {
        id: card.id,
        title: card.title,
        status: card.status,
        displayId:
          cardProject && card.taskNumber
            ? `${cardProject.idPrefix}-${card.taskNumber}`
            : null,
      },
      branchPolicy
    );
    if (!body) {
      return new Response(null, { status: 204 });
    }

    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(null, { status: 204 });
}
