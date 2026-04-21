import { Status } from "../../types";
import { KanbanStore, StoreSlice } from "../types";

export const createUiSlice: StoreSlice<
  Pick<
    KanbanStore,
    | "isSidebarCollapsed"
    | "sidebarWidth"
    | "collapsedSkillGroups"
    | "collapsedColumns"
    | "completedFilter"
    | "isQuickEntryOpen"
    | "toggleSidebar"
    | "setSidebarWidth"
    | "toggleSkillGroupCollapse"
    | "toggleColumnCollapse"
    | "setCompletedFilter"
    | "openQuickEntry"
    | "closeQuickEntry"
    | "toggleQuickEntry"
  >
> = (set) => ({
  isSidebarCollapsed: false,
  sidebarWidth: 256, // Default width (same as w-64)
  collapsedSkillGroups: [],
  collapsedColumns: ["withdrawn"] as Status[],
  completedFilter: "this_week",
  isQuickEntryOpen: false,

  toggleSidebar: () =>
    set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),

  setSidebarWidth: (width: number) => set({ sidebarWidth: width }),

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

  setCompletedFilter: (filter) => set({ completedFilter: filter }),

  openQuickEntry: () => set({ isQuickEntryOpen: true }),
  closeQuickEntry: () => set({ isQuickEntryOpen: false }),
  toggleQuickEntry: () =>
    set((state) => ({ isQuickEntryOpen: !state.isQuickEntryOpen })),
});
