import { parseJson } from "../helpers";
import { KanbanStore, StoreSlice } from "../types";
import type { ToolkitItem } from "@/lib/types";
import { normalizeToolkitFolder } from "@/lib/toolkit-keys";

// The server answers every write with the full list, so a successful response
// simply replaces the optimistic state and a failed one restores the snapshot.
export const createToolkitSlice: StoreSlice<
  Pick<
    KanbanStore,
    | "toolkitItems"
    | "fetchToolkit"
    | "pinToolkitItem"
    | "unpinToolkitItem"
    | "moveToolkitItem"
    | "renameToolkitFolder"
  >
> = (set, get) => {
  const commit = async (projectId: string, response: Response, previous: ToolkitItem[]) => {
    const data = await parseJson<{ items?: ToolkitItem[] }>(response);
    // The user may have switched projects while the request was in flight.
    if (get().activeProjectId !== projectId) return;
    if (!response.ok || !Array.isArray(data.items)) {
      set({ toolkitItems: previous });
      return;
    }
    set({ toolkitItems: data.items });
  };

  // Optimistic PATCH: apply `next` locally, then let the server's list win.
  const patch = async (
    body: Record<string, unknown>,
    next: (items: ToolkitItem[]) => ToolkitItem[]
  ) => {
    const projectId = get().activeProjectId;
    if (!projectId) return;
    const previous = get().toolkitItems;
    set({ toolkitItems: next(previous) });

    try {
      const response = await fetch(`/api/projects/${projectId}/toolkit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await commit(projectId, response, previous);
    } catch (error) {
      console.error("Failed to update toolkit:", error);
      if (get().activeProjectId === projectId) set({ toolkitItems: previous });
    }
  };

  return {
    toolkitItems: [],

    moveToolkitItem: (kind, name, folder) => {
      const target = normalizeToolkitFolder(folder);
      return patch({ kind, name, folder: target }, (items) =>
        items.map((item) =>
          item.kind === kind && item.name === name ? { ...item, folder: target } : item
        )
      );
    },

    renameToolkitFolder: (from, to) => {
      const target = normalizeToolkitFolder(to);
      return patch({ folder: from, rename: target }, (items) =>
        items.map((item) => (item.folder === from ? { ...item, folder: target } : item))
      );
    },

    fetchToolkit: async (projectId) => {
      if (!projectId) {
        set({ toolkitItems: [] });
        return;
      }
      try {
        const response = await fetch(`/api/projects/${projectId}/toolkit`);
        const data = await parseJson<{ items?: ToolkitItem[] }>(response);
        if (get().activeProjectId !== projectId) return;
        set({ toolkitItems: response.ok && Array.isArray(data.items) ? data.items : [] });
      } catch (error) {
        console.error("Failed to fetch toolkit:", error);
        if (get().activeProjectId === projectId) set({ toolkitItems: [] });
      }
    },

    pinToolkitItem: async (kind, name, source) => {
      const projectId = get().activeProjectId;
      if (!projectId) return;
      const previous = get().toolkitItems;
      if (previous.some((item) => item.kind === kind && item.name === name)) return;

      set({
        toolkitItems: [
          ...previous,
          {
            id: `pending-${kind}-${name}`,
            projectId,
            kind,
            name,
            source: source ?? null,
            folder: null,
            order: previous.length ? previous[previous.length - 1].order + 1 : 0,
            createdAt: new Date().toISOString(),
          },
        ],
      });

      try {
        const response = await fetch(`/api/projects/${projectId}/toolkit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, name, source: source ?? null }),
        });
        await commit(projectId, response, previous);
      } catch (error) {
        console.error("Failed to pin toolkit item:", error);
        if (get().activeProjectId === projectId) set({ toolkitItems: previous });
      }
    },

    unpinToolkitItem: async (kind, name) => {
      const projectId = get().activeProjectId;
      if (!projectId) return;
      const previous = get().toolkitItems;

      set({
        toolkitItems: previous.filter((item) => !(item.kind === kind && item.name === name)),
      });

      try {
        const params = new URLSearchParams({ kind, name });
        const response = await fetch(`/api/projects/${projectId}/toolkit?${params}`, {
          method: "DELETE",
        });
        await commit(projectId, response, previous);
      } catch (error) {
        console.error("Failed to unpin toolkit item:", error);
        if (get().activeProjectId === projectId) set({ toolkitItems: previous });
      }
    },
  };
};
