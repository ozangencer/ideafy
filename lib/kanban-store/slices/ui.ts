import { BoardView, BoardViewPreference, SectionType, StaleThresholds, Status } from "../../types";
import { KanbanStore, StoreSlice } from "../types";

export const createUiSlice: StoreSlice<
  Pick<
    KanbanStore,
    | "isSidebarCollapsed"
    | "sidebarWidth"
    | "isProjectListExpanded"
    | "collapsedSkillGroups"
    | "collapsedColumns"
    | "expandedGroups"
    | "uncappedColumns"
    | "completedFilter"
    | "boardView"
    | "boardViewPreference"
    | "staleThresholds"
    | "isQuickEntryOpen"
    | "pendingCardSection"
    | "toggleSidebar"
    | "setSidebarWidth"
    | "toggleProjectListExpanded"
    | "toggleSkillGroupCollapse"
    | "toggleColumnCollapse"
    | "toggleGroupCollapse"
    | "toggleColumnCap"
    | "setCompletedFilter"
    | "setBoardView"
    | "setBoardViewPreference"
    | "setStaleThreshold"
    | "openQuickEntry"
    | "closeQuickEntry"
    | "toggleQuickEntry"
    | "setPendingCardSection"
  >
> = (set) => ({
  isSidebarCollapsed: false,
  sidebarWidth: 256, // Default width (same as w-64)
  isProjectListExpanded: true,
  collapsedSkillGroups: [],
  collapsedColumns: ["withdrawn"] as Status[],
  // Keys are groupFoldKey(groupId, columnId) — fold state belongs to a group's
  // row in one column, not to the group everywhere. This is the exception set,
  // not the collapsed set: a group folds by default, so what has to survive a
  // reload is which rows the user opened. Storing the collapsed side would
  // leave every new group unfolded — the opposite of the point, which is that
  // a 14-card chain occupies one slot until asked.
  expandedGroups: [] as string[],
  // Columns the user opened past the render cap. Same shape and same reasoning
  // as expandedGroups: capping is the default, so what has to survive a reload
  // is the exception the user asked for.
  uncappedColumns: [] as Status[],
  completedFilter: "this_week",
  // The view showing right now. `boardViewPreference` decides what this starts
  // as on load — see the merge step in kanban-store/index.ts.
  boardView: "all" as BoardView,
  boardViewPreference: "last" as BoardViewPreference,
  // Only the columns the user actually changed. An empty map means every
  // column uses the defaults, so the defaults stay free to move later without
  // migrating anybody's settings.
  staleThresholds: {} as StaleThresholds,
  isQuickEntryOpen: false,
  pendingCardSection: null,

  toggleSidebar: () =>
    set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),

  setSidebarWidth: (width: number) => set({ sidebarWidth: width }),

  toggleProjectListExpanded: () =>
    set((state) => ({ isProjectListExpanded: !state.isProjectListExpanded })),

  toggleSkillGroupCollapse: (groupKey) =>
    set((state) => ({
      collapsedSkillGroups: state.collapsedSkillGroups.includes(groupKey)
        ? state.collapsedSkillGroups.filter((key) => key !== groupKey)
        : [...state.collapsedSkillGroups, groupKey],
    })),

  toggleColumnCollapse: (columnId) =>
    set((state) => ({
      collapsedColumns: state.collapsedColumns.includes(columnId)
        ? state.collapsedColumns.filter((id) => id !== columnId)
        : [...state.collapsedColumns, columnId],
    })),

  toggleGroupCollapse: (groupKey) =>
    set((state) => ({
      expandedGroups: state.expandedGroups.includes(groupKey)
        ? state.expandedGroups.filter((key) => key !== groupKey)
        : [...state.expandedGroups, groupKey],
    })),

  toggleColumnCap: (columnId) =>
    set((state) => ({
      uncappedColumns: state.uncappedColumns.includes(columnId)
        ? state.uncappedColumns.filter((id) => id !== columnId)
        : [...state.uncappedColumns, columnId],
    })),

  setCompletedFilter: (filter) => set({ completedFilter: filter }),

  setBoardView: (view) => set({ boardView: view }),

  setBoardViewPreference: (preference) =>
    set((state) => ({
      boardViewPreference: preference,
      // Picking a fixed opening view is also a statement about now: leaving the
      // board on the other one would make the setting look broken until the
      // next launch.
      boardView: preference === "last" ? state.boardView : preference,
    })),

  // A null clears the override rather than storing a zero, so "empty the field"
  // means "use the default" instead of "everything is stale".
  setStaleThreshold: (status, days) =>
    set((state) => {
      const next = { ...state.staleThresholds };
      if (days === null) delete next[status];
      else next[status] = days;
      return { staleThresholds: next };
    }),

  openQuickEntry: () => set({ isQuickEntryOpen: true }),
  closeQuickEntry: () => set({ isQuickEntryOpen: false }),
  toggleQuickEntry: () =>
    set((state) => ({ isQuickEntryOpen: !state.isQuickEntryOpen })),

  setPendingCardSection: (section: SectionType | null) =>
    set({ pendingCardSection: section }),
});
