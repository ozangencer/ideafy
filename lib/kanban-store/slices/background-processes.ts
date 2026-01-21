import { BackgroundProcess } from "../../types";
import { parseJson } from "../helpers";
import { KanbanStore, StoreSlice } from "../types";

export const createBackgroundProcessesSlice: StoreSlice<
  Pick<
    KanbanStore,
    | "backgroundProcesses"
    | "fetchBackgroundProcesses"
    | "killBackgroundProcess"
  >
> = (set) => ({
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
      const response = await fetch(
        `/api/processes?processKey=${encodeURIComponent(processKey)}`,
        { method: "DELETE" }
      );
      if (response.ok) {
        // Refresh the list
        set((state) => ({
          backgroundProcesses: state.backgroundProcesses.filter(
            (p) => p.id !== processKey
          ),
        }));
      }
    } catch (error) {
      console.error("Failed to kill background process:", error);
    }
  },
});
