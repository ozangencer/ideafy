import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createBackgroundProcessesSlice } from "./slices/background-processes";
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
import { CompletedFilter } from "../types";

const VALID_COMPLETED_FILTERS: CompletedFilter[] = ['today', 'yesterday', 'this_week', 'all'];

export const useKanbanStore = create<KanbanStore>()(
  persist(
    (set, get) => ({
      ...createBackgroundProcessesSlice(set, get),
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
        sidebarWidth: state.sidebarWidth,
        collapsedSkillGroups: state.collapsedSkillGroups,
        completedFilter: state.completedFilter,
        expandedDocFolders: state.expandedDocFolders,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<KanbanStore>;
        const collapsedColumns = persisted.collapsedColumns || [];
        if (!collapsedColumns.includes("withdrawn")) {
          collapsedColumns.push("withdrawn");
        }
        // Validate completedFilter - reset to default if invalid
        const completedFilter = persisted.completedFilter &&
          VALID_COMPLETED_FILTERS.includes(persisted.completedFilter)
          ? persisted.completedFilter
          : currentState.completedFilter;
        // Validate sidebarWidth - ensure it's within bounds (200-400px)
        const sidebarWidth = persisted.sidebarWidth &&
          persisted.sidebarWidth >= 200 && persisted.sidebarWidth <= 400
          ? persisted.sidebarWidth
          : currentState.sidebarWidth;
        const collapsedSkillGroups = Array.isArray(persisted.collapsedSkillGroups)
          ? persisted.collapsedSkillGroups
          : currentState.collapsedSkillGroups;
        // Validate expandedDocFolders - ensure it's an array
        const expandedDocFolders = Array.isArray(persisted.expandedDocFolders)
          ? persisted.expandedDocFolders
          : currentState.expandedDocFolders;
        return {
          ...currentState,
          ...persisted,
          collapsedColumns,
          completedFilter,
          sidebarWidth,
          collapsedSkillGroups,
          expandedDocFolders,
        };
      },
    }
  )
);
