import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createActivitySlice } from "./slices/activity";
import { createBackgroundProcessesSlice } from "./slices/background-processes";
import { createQueueSlice } from "./slices/queue";
import { createCardsSlice } from "./slices/cards";
import { createClaudeSlice } from "./slices/claude";
import { createConversationSlice } from "./slices/conversation";
import { createDevServerSlice } from "./slices/dev-server";
import { createDocumentsSlice } from "./slices/documents";
import { createHistorySlice } from "./slices/history";
import { createProjectsSlice } from "./slices/projects";
import { createSettingsSlice } from "./slices/settings";
import { createSkillsSlice } from "./slices/skills";
import { createToolkitSlice } from "./slices/toolkit";
import { createUiSlice } from "./slices/ui";
import { KanbanStore } from "./types";
import { BoardView, BoardViewPreference, CompletedFilter, StaleThresholds, Status } from "../types";

const VALID_COMPLETED_FILTERS: CompletedFilter[] = ['today', 'yesterday', 'this_week', 'all'];
const VALID_BOARD_VIEWS: BoardView[] = ['focus', 'all', 'chains'];
const VALID_BOARD_VIEW_PREFERENCES: BoardViewPreference[] = ['focus', 'all', 'chains', 'last'];
const STALE_THRESHOLD_STATUSES: Status[] = ['ideation', 'backlog', 'bugs', 'progress', 'test'];

/**
 * Keeps only whole-day counts of at least one. A stored 0 or -3 — from a
 * hand-edited localStorage entry or an older build — would mark every card in
 * that column stale on load, which reads as the board having eaten itself.
 */
function sanitizeStaleThresholds(value: unknown): StaleThresholds {
  if (!value || typeof value !== 'object') return {};
  const source = value as Record<string, unknown>;
  const result: StaleThresholds = {};
  for (const status of STALE_THRESHOLD_STATUSES) {
    const days = source[status];
    if (typeof days === 'number' && Number.isFinite(days) && days >= 1) {
      result[status] = Math.floor(days);
    }
  }
  return result;
}

export const useKanbanStore = create<KanbanStore>()(
  persist(
    (set, get) => ({
      ...createActivitySlice(set, get),
      ...createBackgroundProcessesSlice(set, get),
      ...createQueueSlice(set, get),
      ...createCardsSlice(set, get),
      ...createHistorySlice(set, get),
      ...createProjectsSlice(set, get),
      ...createDocumentsSlice(set, get),
      ...createUiSlice(set, get),
      ...createSkillsSlice(set, get),
      ...createToolkitSlice(set, get),
      ...createClaudeSlice(set, get),
      ...createDevServerSlice(set, get),
      ...createSettingsSlice(set, get),
      ...createConversationSlice(set, get),
    }),
    {
      name: "kanban-preferences",
      partialize: (state) => ({
        collapsedColumns: state.collapsedColumns,
        expandedGroups: state.expandedGroups,
        uncappedColumns: state.uncappedColumns,
        isSidebarCollapsed: state.isSidebarCollapsed,
        sidebarWidth: state.sidebarWidth,
        isProjectListExpanded: state.isProjectListExpanded,
        completedFilter: state.completedFilter,
        boardView: state.boardView,
        boardViewPreference: state.boardViewPreference,
        staleThresholds: state.staleThresholds,
        expandedDocFolders: state.expandedDocFolders,
        // A cache of the settings row, not the source of truth: it only saves
        // the board from painting Development for a frame before the settings
        // fetch lands. fetchSettings overwrites it.
        activeWorkspace: state.activeWorkspace,
      }),
      merge: (persistedState, currentState) => {
        // Skill groups are gone; drop their fold state from older snapshots so
        // it does not ride along in `...persisted` forever.
        const { collapsedSkillGroups: _drop, ...persisted } =
          (persistedState ?? {}) as Partial<KanbanStore> & { collapsedSkillGroups?: unknown };
        void _drop;
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
        const isProjectListExpanded = typeof persisted.isProjectListExpanded === "boolean"
          ? persisted.isProjectListExpanded
          : currentState.isProjectListExpanded;
        const expandedGroups = Array.isArray(persisted.expandedGroups)
          ? persisted.expandedGroups
          : currentState.expandedGroups;
        const uncappedColumns = Array.isArray(persisted.uncappedColumns)
          ? persisted.uncappedColumns
          : currentState.uncappedColumns;
        const staleThresholds = sanitizeStaleThresholds(persisted.staleThresholds);
        const boardViewPreference =
          persisted.boardViewPreference &&
          VALID_BOARD_VIEW_PREFERENCES.includes(persisted.boardViewPreference)
            ? persisted.boardViewPreference
            : currentState.boardViewPreference;
        // The preference is applied here rather than on first render: a board
        // that paints the columns and then swaps to Focus a frame later reads
        // as a bug, and the toggle would briefly disagree with what is showing.
        const lastBoardView =
          persisted.boardView && VALID_BOARD_VIEWS.includes(persisted.boardView)
            ? persisted.boardView
            : currentState.boardView;
        const boardView =
          boardViewPreference === 'last' ? lastBoardView : boardViewPreference;
        // Validate expandedDocFolders - ensure it's an array
        const expandedDocFolders = Array.isArray(persisted.expandedDocFolders)
          ? persisted.expandedDocFolders
          : currentState.expandedDocFolders;
        const activeWorkspace =
          persisted.activeWorkspace === "work" ? "work" : currentState.activeWorkspace;
        return {
          ...currentState,
          ...persisted,
          collapsedColumns,
          completedFilter,
          sidebarWidth,
          isProjectListExpanded,
          expandedGroups,
          uncappedColumns,
          staleThresholds,
          boardView,
          boardViewPreference,
          expandedDocFolders,
          activeWorkspace,
        };
      },
    }
  )
);
