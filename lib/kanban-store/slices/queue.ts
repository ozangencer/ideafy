import type { QueueAddResult, QueueClearResult, QueueRestoreResult, QueueSnapshot } from "../../card-queue";
import { worktreeOverrideFor } from "../../workspace";
import { parseJson } from "../helpers";
import { KanbanStore, StoreSlice } from "../types";
import { toast } from "@/hooks/use-toast";

/**
 * The run queue as the server last described it. The client never starts a
 * queued run itself — the server does that when the previous run ends, with
 * or without a tab open — so this slice only mirrors and edits the order.
 * A card the queue starts shows its spinner through the background-process
 * poll, and its result lands through syncCardAfterRunEnd, like any other run.
 */
export const createQueueSlice: StoreSlice<
  Pick<
    KanbanStore,
    | "queueState"
    | "fetchQueue"
    | "addToQueue"
    | "setQueuedCardWorktree"
    | "removeFromQueue"
    | "clearQueue"
    | "restoreQueue"
    | "moveInQueue"
    | "setQueueRunning"
  >
> = (set, get) => {
  // Cards carry their own queuePosition for anything that reads the card row
  // alone; keep it in step with the snapshot so the two never disagree.
  const apply = (snapshot: QueueSnapshot) => {
    const rank = new Map(snapshot.items.map((item, index) => [item.cardId, index + 1]));
    const patch = <T extends { id: string; queuePosition: number | null }>(card: T): T => {
      const next = rank.get(card.id) ?? null;
      return card.queuePosition === next ? card : { ...card, queuePosition: next };
    };
    // The 10s poll mostly brings back what the store already holds. Writing
    // it anyway hands every card subscriber a new array (and a new snapshot),
    // so the board and an open modal re-render for nothing; keep the old
    // references unless something actually moved.
    set((state) => {
      const queueState =
        state.queueState && JSON.stringify(state.queueState) === JSON.stringify(snapshot)
          ? state.queueState
          : snapshot;
      let cardsChanged = false;
      const patched = state.cards.map((card) => {
        const next = patch(card);
        if (next !== card) cardsChanged = true;
        return next;
      });
      const cards = cardsChanged ? patched : state.cards;
      const selectedCard = state.selectedCard ? patch(state.selectedCard) : state.selectedCard;
      if (
        queueState === state.queueState &&
        cards === state.cards &&
        selectedCard === state.selectedCard
      ) {
        return state;
      }
      return { queueState, cards, selectedCard };
    });
  };

  const request = async <T>(method: string, body?: unknown): Promise<T> => {
    const response = await fetch("/api/queue", {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const error = await parseJson<{ error?: string }>(response);
      throw new Error(error.error || "Queue request failed");
    }
    return parseJson<T>(response);
  };

  // The queue reads the card's own useWorktree when the run starts, so the
  // branch choice is just that field. Each card is normalized against its own
  // project's default: a selection can span projects.
  const writeWorktreeChoice = async (cardId: string, choice: boolean): Promise<boolean> => {
    const { cards, projects } = get();
    const card = cards.find((c) => c.id === cardId);
    if (!card) return false;
    // A Human Test card queues for pre-verify, which runs where its code was
    // written. The branch picked for the implementation cards in a mixed
    // selection is not this card's to take: it would only change its next
    // implementation run, if it ever goes back to one.
    if (card.status === "test") return true;
    const project = projects.find((p) => p.id === card.projectId);
    const override = worktreeOverrideFor(choice, project?.useWorktrees ?? true);
    if (override === (card.useWorktree ?? null)) return true;
    return get().updateCard(cardId, { useWorktree: override });
  };

  return {
    queueState: null,

    fetchQueue: async () => {
      try {
        const previous = get().queueState;
        const snapshot = await request<QueueSnapshot>("GET");
        apply(snapshot);
        // "Queue paused" and "Dropped from queue" land in the bell straight
        // from the server, not through a finished process, so the bell would
        // otherwise wait for its own 30s poll. A card leaving because its run
        // started refreshes too; that costs one extra read, nothing more.
        if (previous) {
          const remaining = new Set(snapshot.items.map((item) => item.cardId));
          const pauseChanged =
            !!snapshot.pausedReason && snapshot.pausedReason !== previous.pausedReason;
          const lostItem = previous.items.some((item) => !remaining.has(item.cardId));
          if (pauseChanged || lostItem) void get().fetchActivity();
        }
      } catch (error) {
        console.error("Failed to fetch run queue:", error);
      }
    },

    addToQueue: async (cardIds, options) => {
      // One POST per card, in the order given, so a board selection lands in
      // board order behind whatever was already waiting.
      const overlapLines: string[] = [];
      const worktreeWarnings: string[] = [];
      const failures: string[] = [];
      let added = 0;
      for (const cardId of cardIds) {
        try {
          // Written first: the POST's warning reads the card's branch choice.
          // If the POST then refuses the card, the choice stays on it, as it
          // would after a Start dialog you closed.
          if (options?.useWorktree !== undefined) {
            await writeWorktreeChoice(cardId, options.useWorktree);
          }
          const result = await request<QueueAddResult>(
            "POST",
            options?.verifyScope ? { cardId, verifyScope: options.verifyScope } : { cardId }
          );
          apply(result);
          added += 1;
          const self = result.items.find((item) => item.cardId === cardId);
          for (const overlap of result.overlaps) {
            overlapLines.push(
              `${self?.displayId ?? "This card"} shares ${overlap.files.join(", ")} with ${overlap.displayId}`
            );
          }
          if (result.worktreeWarning) worktreeWarnings.push(result.worktreeWarning);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }

      if (failures.length > 0) {
        toast({
          title: added > 0 ? `Queued ${added}, skipped ${failures.length}` : "Couldn't add to queue",
          description: failures.join("; "),
          variant: "destructive",
        });
      }
      // Warnings, not refusals: the cards are queued either way. Same file in
      // two queued cards still means a merge conflict later, since each one
      // branches from main before the other is merged.
      if (overlapLines.length > 0 || worktreeWarnings.length > 0) {
        toast({
          title: "Queued — heads up",
          description: [...overlapLines, ...worktreeWarnings].join("; "),
        });
      } else if (added > 0 && failures.length === 0) {
        const state = get().queueState;
        toast({
          title: added === 1 ? "Added to queue" : `Added ${added} cards to queue`,
          description: state?.pausedReason
            ? `Queue is paused (${state.pausedReason}) — press Resume to start it.`
            : undefined,
        });
      }
    },

    // Not a POST: re-adding a queued card without afterCardId moves it to the
    // back. A fresh snapshot brings the row's badge and the warnings along.
    setQueuedCardWorktree: async (cardId, useWorktree) => {
      if (!(await writeWorktreeChoice(cardId, useWorktree))) {
        toast({ title: "Couldn't change the branch", variant: "destructive" });
        return;
      }
      await get().fetchQueue();
    },

    removeFromQueue: async (cardId) => {
      try {
        apply(await request<QueueSnapshot>("DELETE", { cardId }));
      } catch (error) {
        console.error("Failed to remove from queue:", error);
        toast({ title: "Couldn't remove from queue", variant: "destructive" });
      }
    },

    // The Undo toast is the caller's: it needs a JSX action this file cannot
    // hold. So the result goes back to it, and null means the toast here
    // already said it failed.
    clearQueue: async () => {
      try {
        const result = await request<QueueClearResult>("DELETE", { all: true });
        apply(result);
        return result;
      } catch (error) {
        console.error("Failed to clear the queue:", error);
        toast({ title: "Couldn't clear the queue", variant: "destructive" });
        return null;
      }
    },

    restoreQueue: async (cardIds, resume) => {
      try {
        const result = await request<QueueRestoreResult>("PATCH", { action: "restore", cardIds, resume });
        apply(result);
        if (result.skipped.length > 0) {
          toast({
            title:
              result.skipped.length === 1
                ? `${result.skipped[0].displayId} could not go back in the queue`
                : `${result.skipped.length} cards could not go back in the queue`,
            description: result.skipped.map((s) => `${s.displayId}: ${s.reason}`).join("; "),
          });
        }
      } catch (error) {
        console.error("Failed to restore the queue:", error);
        toast({
          title: "Couldn't restore the queue",
          description: error instanceof Error ? error.message : undefined,
          variant: "destructive",
        });
      }
    },

    moveInQueue: async (cardId, afterCardId) => {
      try {
        apply(await request<QueueAddResult>("POST", { cardId, afterCardId }));
      } catch (error) {
        console.error("Failed to reorder queue:", error);
        toast({
          title: "Couldn't reorder the queue",
          description: error instanceof Error ? error.message : undefined,
          variant: "destructive",
        });
      }
    },

    setQueueRunning: async (running) => {
      try {
        apply(await request<QueueSnapshot>("PATCH", { action: running ? "resume" : "pause" }));
      } catch (error) {
        console.error("Failed to change queue state:", error);
        toast({ title: running ? "Couldn't resume the queue" : "Couldn't pause the queue", variant: "destructive" });
      }
    },
  };
};
