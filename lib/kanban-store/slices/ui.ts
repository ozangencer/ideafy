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
    | "completedFilter"
    | "isQuickEntryOpen"
    | "pendingCardSection"
    | "toggleSidebar"
    | "setSidebarWidth"
    | "toggleProjectListExpanded"
    | "toggleSkillGroupCollapse"
    | "toggleColumnCollapse"
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

  setCompletedFilter: (filter) => set({ completedFilter: filter }),

  openQuickEntry: () => set({ isQuickEntryOpen: true }),
  closeQuickEntry: () => set({ isQuickEntryOpen: false }),
  toggleQuickEntry: () =>
    set((state) => ({ isQuickEntryOpen: !state.isQuickEntryOpen })),

  setPendingCardSection: (section: SectionType | null) =>
    set({ pendingCardSection: section }),
});
