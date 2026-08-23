import * as path from "path";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { generateBranchName } from "@/lib/git";

// The policy TEXT moved to lib/prompts/phase-policy.ts, which has to stay
// import-free so scripts/sync-mcp-shared.mjs can copy it into mcp-server
// verbatim (see the header there). Only the two functions that need the
// database and the git helpers stayed behind. Everything else is re-exported
// so this file is still the one import site callers know about.
export {
  isTerminalPhase,
  buildPhasePolicy,
  buildPhasePolicyBody,
  buildCreationOfferPolicy,
} from "@/lib/prompts/phase-policy";

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
