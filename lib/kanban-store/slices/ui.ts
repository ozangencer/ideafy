import { Status } from "../../types";
import { KanbanStore, StoreSlice } from "../types";

export const createUiSlice: StoreSlice<
  Pick<
    KanbanStore,
    | "isSidebarCollapsed"
    | "sidebarWidth"
    | "collapsedColumns"
    | "completedFilter"
    | "isQuickEntryOpen"
    | "hidePooledCards"
    | "toggleSidebar"
    | "setSidebarWidth"
    | "toggleColumnCollapse"
    | "setCompletedFilter"
    | "openQuickEntry"
    | "closeQuickEntry"
    | "toggleQuickEntry"
    | "toggleHidePooledCards"
  >
> = (set) => ({
  isSidebarCollapsed: false,
  sidebarWidth: 256, // Default width (same as w-64)
  collapsedColumns: ["withdrawn"] as Status[],
  completedFilter: "this_week",
  isQuickEntryOpen: false,
  hidePooledCards: true,

  toggleSidebar: () =>
    set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),

  setSidebarWidth: (width: number) => set({ sidebarWidth: width }),

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

  toggleHidePooledCards: () =>
    set((state) => ({ hidePooledCards: !state.hidePooledCards })),
});
