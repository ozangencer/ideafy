import { Status } from "../../types";
import { KanbanStore, StoreSlice } from "../types";

export const createUiSlice: StoreSlice<
  Pick<
    KanbanStore,
    | "isSidebarCollapsed"
    | "collapsedColumns"
    | "completedFilter"
    | "toggleSidebar"
    | "toggleColumnCollapse"
    | "setCompletedFilter"
  >
> = (set) => ({
  isSidebarCollapsed: false,
  collapsedColumns: ["withdrawn"] as Status[],
  completedFilter: "this_week",

  toggleSidebar: () =>
    set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),

  toggleColumnCollapse: (columnId) =>
    set((state) => ({
      collapsedColumns: state.collapsedColumns.includes(columnId)
        ? state.collapsedColumns.filter((id) => id !== columnId)
        : [...state.collapsedColumns, columnId],
    })),

  setCompletedFilter: (filter) => set({ completedFilter: filter }),
});
