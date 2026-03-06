import { Card, Status } from "../../types";
import { nowIso, parseJson, replaceCardById, updateCardById } from "../helpers";
import { KanbanStore, StoreSlice } from "../types";

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
  poolCardId: null,
  createdAt: nowIso(),
  updatedAt: nowIso(),
  completedAt: null,
});

export const createCardsSlice: StoreSlice<
  Pick<
    KanbanStore,
    | "cards"
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
    | "selectCard"
    | "openModal"
    | "closeModal"
    | "setSearchQuery"
  >
> = (set, get) => ({
  cards: [],
  selectedCard: null,
  draftCard: null,
  isModalOpen: false,
  searchQuery: "",
  isLoading: false,

  fetchCards: async () => {
    set({ isLoading: true });
    try {
      const response = await fetch("/api/cards");
      const cards = await parseJson<Card[]>(response);

      const currentSelectedCard = get().selectedCard;
      let newSelectedCard = currentSelectedCard;
      if (currentSelectedCard) {
        const updatedCard = cards.find((c) => c.id === currentSelectedCard.id);
        if (updatedCard) {
          newSelectedCard = updatedCard;
        }
      }

      set({ cards, selectedCard: newSelectedCard, isLoading: false });
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
    const previousCards = get().cards;
    set((state) => ({
      cards: updateCardById(state.cards, id, {
        ...updates,
        updatedAt: nowIso(),
      }),
    }));

    try {
      const response = await fetch(`/api/cards/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const updatedCard = await parseJson<Card>(response);
      set((state) => ({
        cards: replaceCardById(state.cards, id, updatedCard),
      }));
    } catch (error) {
      console.error("Failed to update card:", error);
      set({ cards: previousCards });
    }
  },

  deleteCard: async (id) => {
    try {
      await fetch(`/api/cards/${id}`, { method: "DELETE" });
      set((state) => ({
        cards: state.cards.filter((card) => card.id !== id),
        selectedCard: state.selectedCard?.id === id ? null : state.selectedCard,
        isModalOpen: state.selectedCard?.id === id ? false : state.isModalOpen,
      }));
    } catch (error) {
      console.error("Failed to delete card:", error);
    }
  },

  moveCard: async (id, newStatus) => {
    const previousCards = get().cards;
    set((state) => ({
      cards: updateCardById(state.cards, id, {
        status: newStatus,
        updatedAt: nowIso(),
      }),
    }));

    try {
      await fetch(`/api/cards/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch (error) {
      console.error("Failed to move card:", error);
      set({ cards: previousCards });
    }
  },

  selectCard: (card) => set({ selectedCard: card }),
  openModal: () => set({ isModalOpen: true }),
  closeModal: () => set({ isModalOpen: false, selectedCard: null }),
  setSearchQuery: (query) => set({ searchQuery: query }),
});
