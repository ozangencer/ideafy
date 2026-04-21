import { NextRequest } from "next/server";
import { existsSync } from "fs";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCurrentBranch, isGitRepo } from "@/lib/git";
import { resolveEffectiveWorktree } from "@/lib/hook-policy";

// Claude Code PreToolUse hook endpoint. The hook POSTs the tool-call payload;
// we respond with a deny decision when the session is bound to a card that
// requires a feature branch and the working tree is on the wrong branch.
//
// Fail-open: any unexpected error returns 204 so a broken Ideafy install
// cannot wedge the user's editor.
const ENFORCED_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);

function ok204() {
  return new Response(null, { status: 204 });
}

function deny(reason: string) {
  return new Response(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const toolName = typeof payload.tool_name === "string" ? payload.tool_name : "";
    if (!ENFORCED_TOOLS.has(toolName)) return ok204();

    const sessionId =
      typeof payload.session_id === "string" ? payload.session_id : "";
    const hookCwd = typeof payload.cwd === "string" ? payload.cwd : "";
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
    if (card.status !== "progress") return ok204();

    const project = card.projectId
      ? db
          .select()
          .from(schema.projects)
          .where(eq(schema.projects.id, card.projectId))
          .get()
      : null;

    const { enforced, targetBranch } = resolveEffectiveWorktree(
      {
        useWorktree: card.useWorktree,
        gitBranchName: card.gitBranchName,
        taskNumber: card.taskNumber,
        title: card.title,
      },
      project ? { useWorktrees: project.useWorktrees, idPrefix: project.idPrefix } : null
    );

    if (!enforced || !targetBranch) return ok204();

    const cwd =
      card.gitWorktreePath && existsSync(card.gitWorktreePath)
        ? card.gitWorktreePath
        : hookCwd || project?.folderPath || card.projectFolder || "";

    if (!cwd || !(await isGitRepo(cwd))) return ok204();

    const currentBranch = await getCurrentBranch(cwd);
    if (currentBranch === targetBranch) return ok204();

    const displayBranch = currentBranch || "(detached HEAD or unknown)";
    return deny(
      `Ideafy: this card must be implemented on branch "${targetBranch}", ` +
        `but the current working tree (${cwd}) is on "${displayBranch}". ` +
        `Call mcp__ideafy__ensure_branch with cardId "${card.id}" to fix this, ` +
        `then retry the edit.`
    );
  } catch (error) {
    console.error("[pre-edit-check] unexpected error", error);
    return ok204();
  }
}
