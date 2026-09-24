import { Card } from "../../types";
import { parseJson, replaceCardById } from "../helpers";
import { KanbanStore, StoreSlice, UndoEntry, UndoResult, UndoStep } from "../types";

// Twenty is well past the "I just deleted 8-10 cards" case that asked for this
// and still small enough that nobody undoes into moves they no longer remember.
const UNDO_LIMIT = 20;

type StepOutcome = "done" | "gone" | { error: string };

/**
 * Reverses one step. "gone" means the thing to undo no longer exists (the card
 * was deleted meanwhile, or its trash snapshot was pruned) — that step is
 * skipped quietly; an error is something the user should hear about.
 */
async function undoStep(
  step: UndoStep,
  set: Parameters<StoreSlice<unknown>>[0],
  get: () => KanbanStore
): Promise<StepOutcome> {
  if (step.kind === "move") {
    if (!get().cards.some((card) => card.id === step.cardId)) return "gone";
    const response = await fetch(`/api/cards/${step.cardId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: step.prevStatus, completedAt: step.prevCompletedAt }),
    });
    if (response.status === 404) return "gone";
    if (!response.ok) return { error: "Failed to move the card back" };
    const updated = await parseJson<Card>(response);
    set((state) => ({
      cards: replaceCardById(state.cards, step.cardId, updated),
      selectedCard: state.selectedCard?.id === step.cardId ? updated : state.selectedCard,
    }));
    return "done";
  }

  const response = await fetch(`/api/cards/${step.cardId}/restore`, { method: "POST" });
  if (response.status === 404) return "gone";
  if (!response.ok) {
    const body = await parseJson<{ error?: string }>(response);
    return { error: body.error || "Failed to restore the card" };
  }
  const restored = await parseJson<Card>(response);
  set((state) => ({
    cards: state.cards.some((card) => card.id === restored.id)
      ? replaceCardById(state.cards, restored.id, restored)
      : [...state.cards, restored],
  }));
  return "done";
}

export const createHistorySlice: StoreSlice<
  Pick<
    KanbanStore,
    | "undoStack"
    | "undoBatch"
    | "isUndoing"
    | "pushUndoStep"
    | "beginUndoBatch"
    | "endUndoBatch"
    | "undo"
  >
> = (set, get) => ({
  undoStack: [],
  undoBatch: null,
  isUndoing: false,

  pushUndoStep: (step, label) => {
    const batch = get().undoBatch;
    if (batch) {
      set({ undoBatch: { ...batch, steps: [...batch.steps, step] } });
      return;
    }
    const entry: UndoEntry = { id: crypto.randomUUID(), label, steps: [step], at: Date.now() };
    set((state) => ({ undoStack: [...state.undoStack, entry].slice(-UNDO_LIMIT) }));
  },

  beginUndoBatch: (label) => set({ undoBatch: { label, steps: [] } }),

  endUndoBatch: (note) => {
    const batch = get().undoBatch;
    set({ undoBatch: null });
    if (!batch || batch.steps.length === 0) return;
    const entry: UndoEntry = {
      id: crypto.randomUUID(),
      label: batch.steps.length === 1 ? batch.label : `${batch.label} (${batch.steps.length} cards)`,
      steps: batch.steps,
      at: Date.now(),
      note,
    };
    set((state) => ({ undoStack: [...state.undoStack, entry].slice(-UNDO_LIMIT) }));
  },

  // Pops entries until one actually undoes something: an entry whose cards are
  // all gone is dropped silently so one press never "does nothing".
  undo: async () => {
    if (get().isUndoing) return null;
    set({ isUndoing: true });
    try {
      while (get().undoStack.length > 0) {
        const stack = get().undoStack;
        const entry = stack[stack.length - 1];
        set({ undoStack: stack.slice(0, -1) });

        let undone = 0;
        let error: string | null = null;
        // Later steps may depend on earlier ones (move, then delete), so walk
        // the entry backwards.
        for (const step of [...entry.steps].reverse()) {
          try {
            const outcome = await undoStep(step, set, get);
            if (outcome === "done") undone += 1;
            else if (outcome !== "gone") error = outcome.error;
          } catch (err) {
            console.error("Undo step failed:", err);
            error = "Undo failed";
          }
        }

        if (undone > 0 || error) {
          const result: UndoResult = { entry, undone, error };
          return result;
        }
      }
      return null;
    } finally {
      set({ isUndoing: false });
    }
  },
});
