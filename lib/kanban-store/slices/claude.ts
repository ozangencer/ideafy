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
    | "openTestTerminal"
    | "quickFixTask"
    | "evaluateIdea"
    | "lockCard"
    | "unlockCard"
    | "clearProcessing"
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
      // Start the API call (process starts immediately on backend)
      const fetchPromise = fetch(`/api/cards/${cardId}/start`, {
        method: "POST",
      });

      // Refresh background processes after a short delay to show the new process
      setTimeout(() => get().fetchBackgroundProcesses(), 500);

      const response = await fetchPromise;

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

      // Refresh background processes to remove completed process
      get().fetchBackgroundProcesses();

      return { success: true, phase: data.phase, newStatus: data.newStatus };
    } catch (error) {
      console.error("Failed to start task:", error);
      set((state) => ({
        startingCardId: null,
        lockedCardIds: removeId(state.lockedCardIds, cardId),
      }));
      // Refresh background processes on error too
      get().fetchBackgroundProcesses();
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

  openTestTerminal: async (cardId) => {
    set((state) => ({
      lockedCardIds: addUniqueId(state.lockedCardIds, cardId),
    }));

    try {
      const response = await fetch(`/api/cards/${cardId}/test-together`, {
        method: "POST",
      });

      const data = await parseJson<{ message?: string; error?: string }>(response);

      if (!response.ok) {
        set((state) => ({
          lockedCardIds: removeId(state.lockedCardIds, cardId),
        }));
        return {
          success: false,
          error: data.error || "Failed to open test terminal",
        };
      }

      return { success: true, message: data.message };
    } catch (error) {
      console.error("Failed to open test terminal:", error);
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

    // Poll while the request is in-flight so the banner catches the process
    // as soon as it spawns (worktree setup may delay the spawn by several seconds).
    const pollInterval = setInterval(() => {
      get().fetchBackgroundProcesses();
    }, 1000);

    try {
      // Start the API call (process starts immediately on backend)
      const fetchPromise = fetch(`/api/cards/${cardId}/quick-fix`, {
        method: "POST",
      });

      const response = await fetchPromise;
      clearInterval(pollInterval);

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

      // Refresh background processes to remove completed process
      get().fetchBackgroundProcesses();

      return { success: true };
    } catch (error) {
      clearInterval(pollInterval);
      console.error("Failed to quick fix:", error);
      set((state) => ({
        quickFixingCardId: null,
        lockedCardIds: removeId(state.lockedCardIds, cardId),
      }));
      // Refresh background processes on error too
      get().fetchBackgroundProcesses();
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
      // Start the API call (process starts immediately on backend)
      const fetchPromise = fetch(`/api/cards/${cardId}/evaluate`, {
        method: "POST",
      });

      // Refresh background processes after a short delay to show the new process
      setTimeout(() => get().fetchBackgroundProcesses(), 500);

      const response = await fetchPromise;

      const data = await parseJson<{
        aiOpinion: string;
        aiVerdict?: Card["aiVerdict"];
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
            aiVerdict: data.aiVerdict ?? null,
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

      // Refresh background processes to remove completed process
      get().fetchBackgroundProcesses();

      return { success: true };
    } catch (error) {
      console.error("Failed to evaluate idea:", error);
      set((state) => ({
        evaluatingCardIds: removeId(state.evaluatingCardIds, cardId),
        lockedCardIds: removeId(state.lockedCardIds, cardId),
      }));
      // Refresh background processes on error too
      get().fetchBackgroundProcesses();
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

  clearProcessing: async (cardId) => {
    try {
      const response = await fetch(`/api/cards/${cardId}/clear-processing`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = await parseJson<{ error?: string }>(response);
        return { success: false, error: data.error || "Failed to clear processing" };
      }

      // Update local state
      set((state) => ({
        startingCardId: state.startingCardId === cardId ? null : state.startingCardId,
        quickFixingCardId: state.quickFixingCardId === cardId ? null : state.quickFixingCardId,
        evaluatingCardIds: removeId(state.evaluatingCardIds, cardId),
        lockedCardIds: removeId(state.lockedCardIds, cardId),
        cards: state.cards.map((card) =>
          card.id === cardId
            ? { ...card, processingType: null, updatedAt: nowIso() }
            : card
        ),
      }));

      return { success: true };
    } catch (error) {
      console.error("Failed to clear processing:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});
