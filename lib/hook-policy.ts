import * as path from "path";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { generateBranchName } from "@/lib/git";

const PHASE_INSTRUCTIONS: Record<string, string> = {
  ideation:
    "propose save_opinion. If your verdict is positive, save_opinion moves the card to Backlog. If your verdict is negative, ALSO call move_card to put the card in 'withdrawn' after saving the opinion.",
  backlog:
    "propose save_plan. This moves the card to In Progress.",
  bugs:
    "propose save_plan. This moves the card to In Progress.",
  progress:
    "propose save_tests. This moves the card to Human Test.",
};

export function isTerminalPhase(status: string | null | undefined): boolean {
  return status === "test" || status === "completed" || status === "withdrawn";
}

// Compute the effective worktree policy for a card: card-level override wins,
// else project default, else true. Returns the target branch name if
// enforcement is active — reused by both the hook policy renderer and the
// pre-edit-check endpoint so they agree on "what branch should this card be
// on right now".
export function resolveEffectiveWorktree(
  card: {
    useWorktree: boolean | null;
    gitBranchName: string | null;
    taskNumber: number | null;
    title: string;
  },
  project: { useWorktrees: boolean; idPrefix: string } | null
): { enforced: boolean; targetBranch: string | null } {
  const effective = card.useWorktree ?? project?.useWorktrees ?? true;
  if (!effective) return { enforced: false, targetBranch: null };

  if (card.gitBranchName) {
    return { enforced: true, targetBranch: card.gitBranchName };
  }

  if (project && card.taskNumber != null) {
    return {
      enforced: true,
      targetBranch: generateBranchName(project.idPrefix, card.taskNumber, card.title),
    };
  }

  return { enforced: true, targetBranch: null };
}

// Phase-aware policy block used once a session is bound to a card.
export function buildPhasePolicy(
  card: {
    id: string;
    title: string;
    status: string;
  },
  branchPolicy?: { enforced: boolean; targetBranch: string | null }
): string | null {
  const phaseInstruction = PHASE_INSTRUCTIONS[card.status];
  if (!phaseInstruction) return null;

  const title = (card.title || "").replace(/"/g, '\\"');

  const lines = [
    "<system-reminder>",
    `Ideafy card: ${card.id} — "${title}"`,
    `Current column: ${card.status}`,
    "",
    "Policy for this session:",
    "1. When you believe the current phase is complete, STOP and ASK the user for",
    "   confirmation before calling any save_* tool. Do not call the tool yourself",
    "   until the user agrees.",
    `2. For this card in column "${card.status}", the expected action is: ${phaseInstruction}`,
    "3. Ask in a single short sentence. Wait for a clear yes/no from the user.",
    "4. On 'yes', call the tool immediately in the same turn. Do not ask again,",
    "   do not announce, do not wait for further confirmation.",
    "5. On 'no', continue the conversation without calling any tool.",
    "6. A 'no' means 'not yet', not 'never'. Keep working on the same phase.",
    "7. Re-ask at the next natural stopping point IF the phase has meaningfully",
    "   progressed since the last refusal (new content added, a previously-open",
    "   question resolved, a missing section filled in). Do not re-ask on cosmetic",
    "   or no-op turns.",
  ];

  if (branchPolicy?.enforced && branchPolicy.targetBranch) {
    lines.push(
      `8. This card must be implemented on branch "${branchPolicy.targetBranch}".`,
      "   Before the first Edit/Write/NotebookEdit in this session, verify the",
      "   current branch. If it does not match, call mcp__ideafy__ensure_branch",
      `   with cardId "${card.id}" to create or check out the correct branch.`,
      "   The PreToolUse hook will block edits performed on the wrong branch."
    );
  }

  lines.push("</system-reminder>", "");

  return lines.join("\n");
}

// First-contact policy: shown once per fresh session that lands in a project
// but has no card bound. Asks Claude to propose card creation when the user's
// request looks like real work.
export function buildCreationOfferPolicy(project: {
  id: string;
  name: string;
}): string {
  return [
    "<system-reminder>",
    `You are in Ideafy project "${project.name}" (projectId: ${project.id}).`,
    "No Ideafy card is bound to this session yet.",
    "",
    "Policy for this session:",
    "1. If the user's FIRST request looks like work they would want tracked,",
    "   STOP before doing anything else and ask ONE short sentence proposing",
    "   the column that fits:",
    "     - A new idea that needs evaluation → \"Create this as an Ideation card?\"",
    "     - A known task ready to plan → \"Create this as a Backlog card?\"",
    "     - A bug report or broken behaviour → \"This looks like a bug. Create",
    "       it in the Bugs column?\"",
    "   Decide the column from the user's wording. Do not ask them to choose.",
    "2. CRITICAL: After asking, END YOUR TURN. Do not read files, run tools,",
    "   investigate, plan, or start implementation in the same turn as the",
    "   question. Wait for the user's next message. The only acceptable output",
    "   for this turn is the one-sentence question — nothing before it, nothing",
    "   after it.",
    "3. On the user's 'yes' in the next turn:",
    "     - Call mcp__ideafy__create_card with projectId, a concise title, a",
    "       description drawn from the user's request, and status set to one",
    "       of: 'ideation' | 'backlog' | 'bugs'.",
    "     - Immediately call mcp__ideafy__bind_session_to_card with the returned",
    "       card id. From the next turn onward the phase-aware policy will kick",
    "       in automatically.",
    "     - Then proceed with the actual work the user originally asked for.",
    "4. On 'no' or if the request is a quick debug / read-only / lookup question:",
    "   do not offer again. Proceed with the user's request normally. The user",
    "   can bind a card later by naming one explicitly (e.g. \"this is for",
    "   IDE-125\") — in that case call mcp__ideafy__bind_session_to_card",
    "   directly without creating a new card.",
    "5. This offer is shown only once per session. After this turn the hook will",
    "   stay silent unless a binding is created.",
    "</system-reminder>",
    "",
  ].join("\n");
}

// Resolve an Ideafy project by walking up from `cwd` until a registered
// project folderPath matches. Returns null if nothing matches before reaching
// the filesystem root.
export function resolveProjectByFolderAncestor(
  cwd: string
): { id: string; name: string; folderPath: string } | null {
  if (!cwd || typeof cwd !== "string") return null;

  let current = path.resolve(cwd);
  const root = path.parse(current).root;

  // Hard cap to avoid pathological loops on exotic filesystems.
  for (let i = 0; i < 64; i++) {
    const match = db
      .select({
        id: schema.projects.id,
        name: schema.projects.name,
        folderPath: schema.projects.folderPath,
      })
      .from(schema.projects)
      .where(eq(schema.projects.folderPath, current))
      .get();

    if (match) return match;

    if (current === root) return null;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}
