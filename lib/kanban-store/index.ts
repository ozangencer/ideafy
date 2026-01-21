import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createCardsSlice } from "./slices/cards";
import { createClaudeSlice } from "./slices/claude";
import { createConversationSlice } from "./slices/conversation";
import { createDevServerSlice } from "./slices/dev-server";
import { createDocumentsSlice } from "./slices/documents";
import { createProjectsSlice } from "./slices/projects";
import { createSettingsSlice } from "./slices/settings";
import { createSkillsSlice } from "./slices/skills";
import { createUiSlice } from "./slices/ui";
import { KanbanStore } from "./types";

export const useKanbanStore = create<KanbanStore>()(
  persist(
    (set, get) => ({
      ...createCardsSlice(set, get),
      ...createProjectsSlice(set, get),
      ...createDocumentsSlice(set, get),
      ...createUiSlice(set, get),
      ...createSkillsSlice(set, get),
      ...createClaudeSlice(set, get),
      ...createDevServerSlice(set, get),
      ...createSettingsSlice(set, get),
      ...createConversationSlice(set, get),
    }),
    {
      name: "kanban-preferences",
      partialize: (state) => ({
        collapsedColumns: state.collapsedColumns,
        isSidebarCollapsed: state.isSidebarCollapsed,
        completedFilter: state.completedFilter,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<KanbanStore>;
        const collapsedColumns = persisted.collapsedColumns || [];
        if (!collapsedColumns.includes("withdrawn")) {
          collapsedColumns.push("withdrawn");
        }
        return {
          ...currentState,
          ...persisted,
          collapsedColumns,
        };
      },
    }
  )
);
