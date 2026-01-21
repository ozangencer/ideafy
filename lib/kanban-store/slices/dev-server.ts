import { nowIso, parseJson, updateCardById } from "../helpers";
import { KanbanStore, StoreSlice } from "../types";

export const createDevServerSlice: StoreSlice<
  Pick<KanbanStore, "startDevServer" | "stopDevServer">
> = (set) => ({
  startDevServer: async (cardId) => {
    try {
      const response = await fetch(`/api/cards/${cardId}/dev-server`, {
        method: "POST",
      });

      const data = await parseJson<{ port?: number; pid?: number; error?: string }>(
        response
      );

      if (!response.ok) {
        return { success: false, error: data.error || "Failed to start dev server" };
      }

      set((state) => ({
        cards: updateCardById(state.cards, cardId, {
          devServerPort: data.port ?? null,
          devServerPid: data.pid ?? null,
          updatedAt: nowIso(),
        }),
      }));

      return { success: true, port: data.port };
    } catch (error) {
      console.error("Failed to start dev server:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },

  stopDevServer: async (cardId) => {
    try {
      const response = await fetch(`/api/cards/${cardId}/dev-server`, {
        method: "DELETE",
      });

      const data = await parseJson<{ error?: string }>(response);

      if (!response.ok) {
        return { success: false, error: data.error || "Failed to stop dev server" };
      }

      set((state) => ({
        cards: updateCardById(state.cards, cardId, {
          devServerPort: null,
          devServerPid: null,
          updatedAt: nowIso(),
        }),
      }));

      return { success: true };
    } catch (error) {
      console.error("Failed to stop dev server:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});
