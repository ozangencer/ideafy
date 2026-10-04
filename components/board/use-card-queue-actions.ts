"use client";

import { Card, Project } from "@/lib/types";
import { PhaseActionFlags } from "@/lib/card-phase";
import { useKanbanStore } from "@/lib/store";

/**
 * Where one card stands in the run queue, and nothing else. Rows that only
 * draw the queue chip (Focus, Chains) read this instead of the full hook,
 * which needs the card's phase flags and project.
 */
export function useQueuePlace(cardId: string) {
  // A number, not the snapshot: every 10s poll rebuilds the snapshot, and only
  // the cards whose place actually changed should re-render. 0 = not queued.
  const rank = useKanbanStore(
    (s) => (s.queueState?.items.findIndex((item) => item.cardId === cardId) ?? -1) + 1
  );
  // A string for the same reason; null when not queued.
  const kind = useKanbanStore(
    (s) => s.queueState?.items.find((item) => item.cardId === cardId)?.kind ?? null
  );
  return { rank, kind };
}

/**
 * The run queue as one card sees it: where it stands, whether it may join,
 * and the add/remove calls. The board card's context menu and the modal
 * footer both read it, so the next queue rule lands in one place instead of
 * drifting between the two surfaces.
 *
 * `flags` comes from the caller, which already computed it for its buttons.
 */
export function useCardQueueActions({
  card,
  flags,
  project,
}: {
  card: Card;
  flags: PhaseActionFlags;
  project: Project | undefined;
}) {
  const { rank, kind } = useQueuePlace(card.id);
  const addToQueue = useKanbanStore((s) => s.addToQueue);
  const removeFromQueue = useKanbanStore((s) => s.removeFromQueue);

  const projectMode = project?.mode ?? "development";
  const effectiveUseWorktree = card.useWorktree ?? project?.useWorktrees ?? true;
  // The queue starts autonomous implementation runs and, on Development
  // cards in Human Test, pre-verify runs. The server has the final say (it
  // reads the phase the Start route would), this just keeps the menus from
  // offering it where it can never work.
  const canQueueImplementation = flags.canRunAutonomous && flags.phase === "implementation";
  // No branch to pick: a pre-verify runs where the card was implemented.
  const canQueueVerify =
    flags.canRunAutonomous && flags.phase === "verify" && projectMode !== "work";

  // The card's current setting comes first, so a hover and one click still
  // queue it the way it was going to run.
  const branchChoices = [
    { useWorktree: true, label: "Isolated branch (worktree)" },
    { useWorktree: false, label: "Direct on current branch" },
  ].sort(
    (a, b) =>
      Number(b.useWorktree === effectiveUseWorktree) - Number(a.useWorktree === effectiveUseWorktree)
  );

  // `ids` lets a board selection ride along; the card alone otherwise.
  const add = (useWorktree?: boolean, ids: string[] = [card.id]) =>
    addToQueue(ids, useWorktree === undefined ? undefined : { useWorktree });
  const remove = () => removeFromQueue(card.id);

  return {
    rank,
    kind,
    canQueueImplementation,
    canQueueVerify,
    effectiveUseWorktree,
    branchChoices,
    add,
    remove,
  };
}
