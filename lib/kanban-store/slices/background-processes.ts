import { BackgroundProcess } from "../../types";
import { parseJson } from "../helpers";
import { KanbanStore, StoreSlice } from "../types";

export const createBackgroundProcessesSlice: StoreSlice<
  Pick<
    KanbanStore,
    | "backgroundProcesses"
    | "fetchBackgroundProcesses"
    | "killBackgroundProcess"
    | "clearCompletedProcesses"
  >
> = (set, get) => ({
  backgroundProcesses: [],

  fetchBackgroundProcesses: async () => {
    try {
      const response = await fetch("/api/processes");
      const processes = await parseJson<BackgroundProcess[]>(response);
      set({ backgroundProcesses: Array.isArray(processes) ? processes : [] });
    } catch (error) {
      console.error("Failed to fetch background processes:", error);
    }
  },

  killBackgroundProcess: async (processKey: string) => {
    try {
      // Find the process to get cardId before killing
      const process = get().backgroundProcesses.find((p) => p.id === processKey);
      const cardId = process?.cardId;

      const response = await fetch(
        `/api/processes?processKey=${encodeURIComponent(processKey)}`,
        { method: "DELETE" }
      );

      if (response.ok) {
        // Remove from local list
        set((state) => ({
          backgroundProcesses: state.backgroundProcesses.filter(
            (p) => p.id !== processKey
          ),
        }));

        // Clear processing state on the card (updates DB and local state)
        if (cardId) {
          await get().clearProcessing(cardId);
        }
      }
    } catch (error) {
      console.error("Failed to kill background process:", error);
    }
  },

  clearCompletedProcesses: async () => {
    try {
      const response = await fetch("/api/processes", { method: "POST" });
      if (response.ok) {
        // Remove completed processes from local state
        set((state) => ({
          backgroundProcesses: state.backgroundProcesses.filter(
            (p) => p.status === "running"
          ),
        }));
      }
    } catch (error) {
      console.error("Failed to clear completed processes:", error);
    }
  },
});
