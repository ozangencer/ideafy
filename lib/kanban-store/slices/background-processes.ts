import { BackgroundProcess, OrphanServer } from "../../types";
import { parseJson } from "../helpers";
import { KanbanStore, StoreSlice } from "../types";

export const createBackgroundProcessesSlice: StoreSlice<
  Pick<
    KanbanStore,
    | "backgroundProcesses"
    | "fetchBackgroundProcesses"
    | "killBackgroundProcess"
    | "clearCompletedProcesses"
    | "orphanServers"
    | "fetchOrphanServers"
    | "stopOrphanServer"
  >
> = (set, get) => ({
  backgroundProcesses: [],
  orphanServers: [],

  fetchBackgroundProcesses: async () => {
    try {
      const response = await fetch("/api/processes");
      const processes = await parseJson<BackgroundProcess[]>(response);
      const next = Array.isArray(processes) ? processes : [];
      // Polled every few seconds: an unchanged list must not hand every
      // subscriber a new array.
      if (JSON.stringify(next) === JSON.stringify(get().backgroundProcesses)) return;
      set({ backgroundProcesses: next });
    } catch (error) {
      console.error("Failed to fetch background processes:", error);
    }
  },

  killBackgroundProcess: async (processKey: string) => {
    try {
      // Find the process to get cardId before killing
      const process = get().backgroundProcesses.find((p) => p.id === processKey);
      const cardId = process?.cardId;
      const processType = process?.processType;

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

        // Clear processing state on the card (updates DB and local state).
        // Skip for chat: chat doesn't set card.processingType and may run
        // alongside non-chat flows on the same card.
        if (cardId && processType !== "chat") {
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

  fetchOrphanServers: async (refresh = false) => {
    try {
      const response = await fetch(
        `/api/cards/dev-servers/orphans${refresh ? "?refresh=1" : ""}`
      );
      const servers = await parseJson<OrphanServer[]>(response);
      const next = Array.isArray(servers) ? servers : [];
      if (JSON.stringify(next) === JSON.stringify(get().orphanServers)) return;
      set({ orphanServers: next });
    } catch (error) {
      console.error("Failed to fetch orphan servers:", error);
    }
  },

  stopOrphanServer: async (id: string) => {
    try {
      const response = await fetch(
        `/api/cards/dev-servers/orphans?id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      const body = await parseJson<{ servers?: OrphanServer[]; error?: string }>(response);
      // 404 means the server was already gone; either way the fresh list wins.
      if (Array.isArray(body?.servers)) set({ orphanServers: body.servers });
      else if (response.status === 404) await get().fetchOrphanServers(true);
      return response.ok;
    } catch (error) {
      console.error("Failed to stop orphan server:", error);
      return false;
    }
  },
});
