import { Card, CardGroup, getColumnTitle, Status } from "../../types";
import { projectModeOf } from "../../workspace";
import { nowIso, parseJson, replaceCardById, updateCardById } from "../helpers";
import { CardUpdatePayload, KanbanStore, StoreSlice } from "../types";
import { toast } from "@/hooks/use-toast";

const createDraftCard = (status: Status, projectId: string | null, projectFolder: string): Card => ({
  id: `draft-${Date.now()}`,
  title: "",
  description: "",
  solutionSummary: "",
  testScenarios: "",
  aiOpinion: "",
  aiVerdict: null,
  status,
  complexity: "medium" as const,
  priority: "medium" as const,
  projectFolder,
  projectId,
  groupId: null,
  taskNumber: null,
  gitBranchName: null,
  gitBranchStatus: null,
  gitWorktreePath: null,
  gitWorktreeStatus: null,
  devServerPort: null,
  devServerPid: null,
  rebaseConflict: null,
  conflictFiles: null,
  processingType: null,
  aiPlatform: null,
  useWorktree: null,
  createdAt: nowIso(),
  updatedAt: nowIso(),
  completedAt: null,
});

const cardLabel = (card: Card | undefined) => (card?.title ? `"${card.title}"` : "card");

/**
 * Cards with a run in flight can't be dragged one by one either, so a bulk
 * action leaves them alone rather than moving a card out from under its agent.
 */
function splitRunningCards(state: KanbanStore, ids: string[]) {
  const byId = new Map(state.cards.map((c) => [c.id, c]));
  const eligible: string[] = [];
  let skipped = 0;
  for (const id of ids) {
    const card = byId.get(id);
    if (!card) continue;
    if (card.processingType || state.lockedCardIds.includes(id)) skipped += 1;
    else eligible.push(id);
  }
  return { eligible, skipped };
}

function finishBulk(get: () => KanbanStore, skipped: number, verb: string) {
  const note = skipped > 0 ? `${skipped} skipped (running)` : undefined;
  const topBefore = get().undoStack.at(-1)?.id;
  get().endUndoBatch(note);
  // Nothing landed on the undo stack, so no announce toast is coming — say
  // why the selection didn't move instead of leaving the user guessing.
  if (skipped > 0 && get().undoStack.at(-1)?.id === topBefore) {
    toast({ title: `Nothing ${verb}`, description: note });
  }
  get().clearCardSelection();
}

export const createCardsSlice: StoreSlice<
  Pick<
    KanbanStore,
    | "cards"
    | "cardGroups"
    | "selectedCard"
    | "draftCard"
    | "isModalOpen"
    | "searchQuery"
    | "isLoading"
    | "fetchCards"
    | "setCards"
    | "addCard"
    | "addCardAndOpen"
    | "openNewCardModal"
    | "saveDraftCard"
    | "discardDraft"
    | "updateCard"
    | "deleteCard"
    | "moveCard"
    | "deleteCards"
    | "moveCards"
    | "selectCard"
    | "openModal"
    | "closeModal"
    | "setSearchQuery"
    | "createCardGroup"
    | "updateCardGroup"
    | "deleteCardGroup"
  >
> = (set, get) => ({
  cards: [],
  cardGroups: [],
  selectedCard: null,
  draftCard: null,
  isModalOpen: false,
  searchQuery: "",
  isLoading: false,

  fetchCards: async () => {
    set({ isLoading: true });
    try {
      // Groups ride along with the cards fetch rather than getting their own
      // poll: the rollup is derived from card statuses, so a board that has
      // fresh cards and stale groups would show counts for a chain that no
      // longer exists.
      const [response, groupsResponse] = await Promise.all([
        fetch("/api/cards"),
        fetch("/api/card-groups"),
      ]);
      const cards = await parseJson<Card[]>(response);
      const cardGroups = groupsResponse.ok
        ? await parseJson<CardGroup[]>(groupsResponse)
        : get().cardGroups;

      // Defend optimistic spinner state: if a run is locally in-flight
      // (id is in startingCardIds/quickFixingCardIds/evaluatingCardIds) but
      // the server hasn't yet persisted processingType, keep the local value
      // so the spinner doesn't flicker off mid-run.
      const { startingCardIds, quickFixingCardIds, evaluatingCardIds, cards: prevCards } = get();
      const prevById = new Map(prevCards.map((c) => [c.id, c]));
      const mergedCards = cards.map((serverCard) => {
        if (serverCard.processingType) return serverCard;
        const prev = prevById.get(serverCard.id);
        if (!prev?.processingType) return serverCard;
        const stillStarting = startingCardIds.includes(serverCard.id) && prev.processingType === "autonomous";
        const stillQuickFixing = quickFixingCardIds.includes(serverCard.id) && prev.processingType === "quick-fix";
        const stillEvaluating = evaluatingCardIds.includes(serverCard.id) && prev.processingType === "evaluate";
        if (stillStarting || stillQuickFixing || stillEvaluating) {
          return { ...serverCard, processingType: prev.processingType };
        }
        return serverCard;
      });

      const currentSelectedCard = get().selectedCard;
      let newSelectedCard = currentSelectedCard;
      if (currentSelectedCard) {
        const updatedCard = mergedCards.find((c) => c.id === currentSelectedCard.id);
        if (updatedCard) {
          newSelectedCard = updatedCard;
        }
      }

      // A card deleted or moved away over MCP must not linger in the
      // selection, where a bulk action would still count it.
      const liveIds = new Set(mergedCards.map((c) => c.id));
      const { selectedCardIds } = get();
      const prunedSelection = selectedCardIds.filter((id) => liveIds.has(id));

      set({
        cards: mergedCards,
        cardGroups,
        selectedCard: newSelectedCard,
        isLoading: false,
        ...(prunedSelection.length !== selectedCardIds.length
          ? { selectedCardIds: prunedSelection }
          : {}),
      });
    } catch (error) {
      console.error("Failed to fetch cards:", error);
      set({ isLoading: false });
    }
  },

  setCards: (cards) => set({ cards }),

  addCard: async (cardData) => {
    try {
      const response = await fetch("/api/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cardData),
      });
      const newCard = await parseJson<Card>(response);
      set((state) => ({ cards: [...state.cards, newCard] }));
      return newCard;
    } catch (error) {
      console.error("Failed to add card:", error);
      return null;
    }
  },

  addCardAndOpen: async (cardData) => {
    try {
      const response = await fetch("/api/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cardData),
      });
      const newCard = await parseJson<Card>(response);
      set((state) => ({
        cards: [...state.cards, newCard],
        selectedCard: newCard,
        isModalOpen: true,
      }));
    } catch (error) {
      console.error("Failed to add card:", error);
    }
  },

  openNewCardModal: (status, projectId) => {
    const project = get().projects.find((p) => p.id === projectId);
    const draft = createDraftCard(status, projectId, project?.folderPath || "");
    set({ draftCard: draft, selectedCard: draft, isModalOpen: true });
  },

  saveDraftCard: async (cardData) => {
    try {
      const response = await fetch("/api/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cardData),
      });
      if (!response.ok) {
        const error = await parseJson<{ error?: string }>(response);
        throw new Error(error.error || "Failed to create card");
      }
      const newCard = await parseJson<Card>(response);
      set((state) => ({
        cards: [...state.cards, newCard],
        draftCard: null,
        selectedCard: null,
        isModalOpen: false,
      }));
    } catch (error) {
      console.error("Failed to create card:", error);
      alert(error instanceof Error ? error.message : "Failed to create card");
    }
  },

  discardDraft: () => set({ draftCard: null, selectedCard: null, isModalOpen: false }),

  updateCard: async (id, updates) => {
    const { baseUpdatedAt: _baseUpdatedAt, ...optimisticUpdates } =
      updates as CardUpdatePayload;
    const previousCards = get().cards;
    set((state) => ({
      cards: updateCardById(state.cards, id, {
        ...optimisticUpdates,
        updatedAt: nowIso(),
      }),
    }));

    try {
      const response = await fetch(`/api/cards/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      // A refused write used to land its error body in place of the card.
      if (!response.ok) {
        const body = await parseJson<{ error?: string }>(response);
        console.error("Failed to update card:", body.error || response.status);
        set({ cards: previousCards });
        return false;
      }
      const updatedCard = await parseJson<Card>(response);
      set((state) => ({
        cards: replaceCardById(state.cards, id, updatedCard),
      }));
      return true;
    } catch (error) {
      console.error("Failed to update card:", error);
      set({ cards: previousCards });
      return false;
    }
  },

  deleteCard: async (id, { recordHistory = true } = {}) => {
    const card = get().cards.find((c) => c.id === id);
    try {
      const response = await fetch(`/api/cards/${id}`, { method: "DELETE" });
      // A failed delete used to drop the card anyway; it then reappeared on
      // the next poll with nothing on the undo stack. 404 means it is already
      // gone, so removing it locally is still right.
      if (!response.ok && response.status !== 404) {
        const body = await parseJson<{ error?: string }>(response);
        toast({
          variant: "destructive",
          title: "Couldn't delete card",
          description: body.error || `Server returned ${response.status}`,
        });
        return;
      }
      set((state) => ({
        cards: state.cards.filter((card) => card.id !== id),
        selectedCard: state.selectedCard?.id === id ? null : state.selectedCard,
        isModalOpen: state.selectedCard?.id === id ? false : state.isModalOpen,
      }));
      if (response.ok && recordHistory) {
        get().pushUndoStep({ kind: "delete", cardId: id }, `Deleted ${cardLabel(card)}`);
      }
    } catch (error) {
      console.error("Failed to delete card:", error);
    }
  },

  moveCard: async (id, newStatus, { recordHistory = true } = {}) => {
    const previousCards = get().cards;
    const card = previousCards.find((c) => c.id === id);
    set((state) => ({
      cards: updateCardById(state.cards, id, {
        status: newStatus,
        updatedAt: nowIso(),
      }),
    }));

    try {
      const response = await fetch(`/api/cards/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      // A card dropped back into its own column is a reorder, not a move —
      // recording it would make the next Cmd+Z look like it did nothing.
      if (response.ok && recordHistory && card && card.status !== newStatus) {
        const column = getColumnTitle(newStatus, projectModeOf(card.projectId, get().projects));
        get().pushUndoStep(
          {
            kind: "move",
            cardId: id,
            prevStatus: card.status,
            prevCompletedAt: card.completedAt,
          },
          `Moved ${cardLabel(card)} to ${column}`
        );
      }
    } catch (error) {
      console.error("Failed to move card:", error);
      set({ cards: previousCards });
    }
  },

  deleteCards: async (ids) => {
    const { eligible, skipped } = splitRunningCards(get(), ids);
    get().beginUndoBatch("Deleted selected cards");
    try {
      for (const id of eligible) {
        await get().deleteCard(id);
      }
    } finally {
      finishBulk(get, skipped, "deleted");
    }
  },

  moveCards: async (ids, newStatus) => {
    const { eligible, skipped } = splitRunningCards(get(), ids);
    const column = getColumnTitle(newStatus, get().activeWorkspace);
    get().beginUndoBatch(`Moved selected cards to ${column}`);
    try {
      // moveCard skips the undo record for a card already in the target
      // column, so a mixed selection doesn't leave empty steps behind.
      for (const id of eligible) {
        await get().moveCard(id, newStatus);
      }
    } finally {
      finishBulk(get, skipped, "moved");
    }
  },

  // The board renders a group row only for groups it already holds, so the new
  // group is pushed into the store here rather than waiting for the next
  // fetchCards poll — otherwise the card would sit in a chain with no header
  // for up to ten seconds.
  createCardGroup: async ({ code, name, color = null, projectId = null }) => {
    try {
      const response = await fetch("/api/card-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name, color, projectId }),
      });
      if (!response.ok) {
        const error = await parseJson<{ error?: string }>(response);
        throw new Error(error.error || "Failed to create group");
      }
      const group = await parseJson<CardGroup>(response);
      set((state) => ({
        cardGroups: [...state.cardGroups, group].sort((a, b) =>
          a.code.localeCompare(b.code)
        ),
      }));
      return group;
    } catch (error) {
      console.error("Failed to create card group:", error);
      return null;
    }
  },

  updateCardGroup: async (id, updates) => {
    const previousGroups = get().cardGroups;
    set((state) => ({
      cardGroups: state.cardGroups
        .map((group) => (group.id === id ? { ...group, ...updates } : group))
        .sort((a, b) => a.code.localeCompare(b.code)),
    }));

    try {
      const response = await fetch(`/api/card-groups/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!response.ok) {
        const error = await parseJson<{ error?: string }>(response);
        throw new Error(error.error || "Failed to update group");
      }
      const group = await parseJson<CardGroup>(response);
      set((state) => ({
        cardGroups: state.cardGroups
          .map((existing) => (existing.id === id ? group : existing))
          .sort((a, b) => a.code.localeCompare(b.code)),
      }));
      return true;
    } catch (error) {
      console.error("Failed to update card group:", error);
      set({ cardGroups: previousGroups });
      return false;
    }
  },

  // The route releases the members in the same transaction that drops the
  // group, so the local cards are cleared alongside it — otherwise a card
  // would keep a groupId pointing at nothing until the next fetchCards, and
  // that card silently renders outside its chain with no reason given.
  deleteCardGroup: async (id) => {
    const previousGroups = get().cardGroups;
    const previousCards = get().cards;
    const previousSelected = get().selectedCard;
    set((state) => ({
      cardGroups: state.cardGroups.filter((group) => group.id !== id),
      cards: state.cards.map((card) =>
        card.groupId === id ? { ...card, groupId: null } : card
      ),
      selectedCard:
        state.selectedCard?.groupId === id
          ? { ...state.selectedCard, groupId: null }
          : state.selectedCard,
    }));

    try {
      const response = await fetch(`/api/card-groups/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const error = await parseJson<{ error?: string }>(response);
        throw new Error(error.error || "Failed to delete group");
      }
      return true;
    } catch (error) {
      console.error("Failed to delete card group:", error);
      set({
        cardGroups: previousGroups,
        cards: previousCards,
        selectedCard: previousSelected,
      });
      return false;
    }
  },

  selectCard: (card) => set({ selectedCard: card }),
  // The modal and a board selection are never live together: the selection
  // bar would sit over the panel and ⌫ would mean two things.
  openModal: () =>
    set({ isModalOpen: true, selectedCardIds: [], selectionAnchorId: null }),
  closeModal: () => set({ isModalOpen: false, selectedCard: null }),
  setSearchQuery: (query) => set({ searchQuery: query }),
});
