import { Card } from "../../types";
import {
  addUniqueId,
  nowIso,
  parseJson,
  removeId,
  updateCardById,
} from "../helpers";
import { KanbanStore, StoreSlice } from "../types";

export const createClaudeSlice: StoreSlice<
  Pick<
    KanbanStore,
    | "startingCardId"
    | "quickFixingCardId"
    | "evaluatingCardIds"
    | "lockedCardIds"
    | "startTask"
    | "openTerminal"
    | "openIdeationTerminal"
    | "quickFixTask"
    | "evaluateIdea"
    | "lockCard"
    | "unlockCard"
  >
> = (set, get) => ({
  startingCardId: null,
  quickFixingCardId: null,
  evaluatingCardIds: [],
  lockedCardIds: [],

  startTask: async (cardId) => {
    set((state) => ({
      startingCardId: cardId,
      lockedCardIds: addUniqueId(state.lockedCardIds, cardId),
    }));

    try {
      const response = await fetch(`/api/cards/${cardId}/start`, {
        method: "POST",
      });

      const data = await parseJson<{
        phase: string;
        newStatus: Card["status"];
        response: string;
        complexity?: Card["complexity"];
        priority?: Card["priority"];
        error?: string;
      }>(response);

      if (!response.ok) {
        set((state) => ({
          startingCardId: null,
          lockedCardIds: removeId(state.lockedCardIds, cardId),
        }));
        return { success: false, error: data.error || "Failed to start task" };
      }

      set((state) => ({
        cards: state.cards.map((card) => {
          if (card.id !== cardId) return card;

          const updates: Partial<Card> = {
            status: data.newStatus,
            updatedAt: nowIso(),
          };

          if (data.phase === "planning") {
            updates.solutionSummary = data.response;
            if (data.complexity) {
              updates.complexity = data.complexity;
            }
            if (data.priority) {
              updates.priority = data.priority;
            }
          } else if (data.phase === "implementation" || data.phase === "retest") {
            updates.testScenarios = data.response;
          }

          return { ...card, ...updates };
        }),
        startingCardId: null,
        lockedCardIds: removeId(state.lockedCardIds, cardId),
      }));

      return { success: true, phase: data.phase, newStatus: data.newStatus };
    } catch (error) {
      console.error("Failed to start task:", error);
      set((state) => ({
        startingCardId: null,
        lockedCardIds: removeId(state.lockedCardIds, cardId),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },

  openTerminal: async (cardId) => {
    set((state) => ({
      lockedCardIds: addUniqueId(state.lockedCardIds, cardId),
    }));

    try {
      const response = await fetch(`/api/cards/${cardId}/open-terminal`, {
        method: "POST",
      });

      const data = await parseJson<{
        phase: string;
        newStatus: Card["status"];
        message?: string;
        error?: string;
      }>(response);

      if (!response.ok) {
        set((state) => ({
          lockedCardIds: removeId(state.lockedCardIds, cardId),
        }));
        return { success: false, error: data.error || "Failed to open terminal" };
      }

      set((state) => ({
        cards: updateCardById(state.cards, cardId, {
          status: data.newStatus,
          updatedAt: nowIso(),
        }),
      }));

      return {
        success: true,
        phase: data.phase,
        newStatus: data.newStatus,
        message: data.message,
      };
    } catch (error) {
      console.error("Failed to open terminal:", error);
      set((state) => ({
        lockedCardIds: removeId(state.lockedCardIds, cardId),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },

  openIdeationTerminal: async (cardId) => {
    set((state) => ({
      lockedCardIds: addUniqueId(state.lockedCardIds, cardId),
    }));

    try {
      const response = await fetch(`/api/cards/${cardId}/ideate`, {
        method: "POST",
      });

      const data = await parseJson<{ message?: string; error?: string }>(response);

      if (!response.ok) {
        set((state) => ({
          lockedCardIds: removeId(state.lockedCardIds, cardId),
        }));
        return {
          success: false,
          error: data.error || "Failed to open ideation terminal",
        };
      }

      return { success: true, message: data.message };
    } catch (error) {
      console.error("Failed to open ideation terminal:", error);
      set((state) => ({
        lockedCardIds: removeId(state.lockedCardIds, cardId),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },

  quickFixTask: async (cardId) => {
    set((state) => ({
      quickFixingCardId: cardId,
      lockedCardIds: addUniqueId(state.lockedCardIds, cardId),
    }));

    try {
      const response = await fetch(`/api/cards/${cardId}/quick-fix`, {
        method: "POST",
      });

      const data = await parseJson<{
        newStatus: Card["status"];
        solutionSummary: string;
        testScenarios: string;
        error?: string;
      }>(response);

      if (!response.ok) {
        set((state) => ({
          quickFixingCardId: null,
          lockedCardIds: removeId(state.lockedCardIds, cardId),
        }));
        return { success: false, error: data.error || "Failed to quick fix" };
      }

      set((state) => ({
        cards: updateCardById(state.cards, cardId, {
          status: data.newStatus,
          solutionSummary: data.solutionSummary,
          testScenarios: data.testScenarios,
          updatedAt: nowIso(),
        }),
        quickFixingCardId: null,
        lockedCardIds: removeId(state.lockedCardIds, cardId),
      }));

      return { success: true };
    } catch (error) {
      console.error("Failed to quick fix:", error);
      set((state) => ({
        quickFixingCardId: null,
        lockedCardIds: removeId(state.lockedCardIds, cardId),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },

  evaluateIdea: async (cardId) => {
    set((state) => ({
      evaluatingCardIds: addUniqueId(state.evaluatingCardIds, cardId),
      lockedCardIds: addUniqueId(state.lockedCardIds, cardId),
    }));

    try {
      const response = await fetch(`/api/cards/${cardId}/evaluate`, {
        method: "POST",
      });

      const data = await parseJson<{
        aiOpinion: string;
        priority?: Card["priority"];
        complexity?: Card["complexity"];
        error?: string;
      }>(response);

      if (!response.ok) {
        set((state) => ({
          evaluatingCardIds: removeId(state.evaluatingCardIds, cardId),
          lockedCardIds: removeId(state.lockedCardIds, cardId),
        }));
        return { success: false, error: data.error || "Failed to evaluate idea" };
      }

      set((state) => ({
        cards: state.cards.map((card) => {
          if (card.id !== cardId) return card;

          const updates: Partial<Card> = {
            aiOpinion: data.aiOpinion,
            updatedAt: nowIso(),
          };

          if (data.priority) {
            updates.priority = data.priority;
          }

          if (data.complexity) {
            updates.complexity = data.complexity;
          }

          return { ...card, ...updates };
        }),
        evaluatingCardIds: removeId(state.evaluatingCardIds, cardId),
        lockedCardIds: removeId(state.lockedCardIds, cardId),
      }));

      return { success: true };
    } catch (error) {
      console.error("Failed to evaluate idea:", error);
      set((state) => ({
        evaluatingCardIds: removeId(state.evaluatingCardIds, cardId),
        lockedCardIds: removeId(state.lockedCardIds, cardId),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },

  lockCard: (cardId) => {
    set((state) => ({
      lockedCardIds: addUniqueId(state.lockedCardIds, cardId),
    }));
  },

  unlockCard: (cardId) => {
    set((state) => ({
      lockedCardIds: removeId(state.lockedCardIds, cardId),
    }));
  },
});
