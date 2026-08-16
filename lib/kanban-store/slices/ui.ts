import { SectionType, Status } from "../../types";
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
    | "completedFilter"
    | "isQuickEntryOpen"
    | "pendingCardSection"
    | "toggleSidebar"
    | "setSidebarWidth"
    | "toggleProjectListExpanded"
    | "toggleSkillGroupCollapse"
    | "toggleColumnCollapse"
    | "toggleGroupCollapse"
    | "setCompletedFilter"
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
  completedFilter: "this_week",
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

  setCompletedFilter: (filter) => set({ completedFilter: filter }),

  openQuickEntry: () => set({ isQuickEntryOpen: true }),
  closeQuickEntry: () => set({ isQuickEntryOpen: false }),
  toggleQuickEntry: () =>
    set((state) => ({ isQuickEntryOpen: !state.isQuickEntryOpen })),

  setPendingCardSection: (section: SectionType | null) =>
    set({ pendingCardSection: section }),
});
