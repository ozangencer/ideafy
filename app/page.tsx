"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/sidebar/sidebar";
import { KanbanBoard } from "@/components/board/kanban-board";
import { PoolView } from "@/components/board/pool-view";
import { CardModal } from "@/components/board/card-modal";
import { DocumentEditor } from "@/components/editor/document-editor";
import { ThemeToggle } from "@/components/theme-toggle";
import { BackupMenu } from "@/components/backup-menu";
import { BackgroundProcesses } from "@/components/background-processes";
import { useKanbanStore } from "@/lib/store";
import { useKeyboardShortcuts } from "@/lib/use-keyboard-shortcuts";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, LayoutGrid, Table2 } from "lucide-react";

type ViewMode = "board" | "pool";

export default function Home() {
  const {
    fetchCards,
    fetchProjects,
    fetchSettings,
    fetchSkills,
    fetchMcps,
    fetchDocuments,
    isModalOpen,
    isLoading,
    cards,
    searchQuery,
    setSearchQuery,
    isDocumentEditorOpen,
    activeProjectId,
    projects,
    teamMode,
    initTeam,
  } = useKanbanStore();

  const [viewMode, setViewMode] = useState<ViewMode>("board");

  useKeyboardShortcuts();

  // Electron IPC: listen for global Cmd+K trigger
  const { openQuickEntry } = useKanbanStore();
  useEffect(() => {
    const handler = () => openQuickEntry();
    window.addEventListener("trigger-quick-entry", handler);
    return () => window.removeEventListener("trigger-quick-entry", handler);
  }, [openQuickEntry]);

  // Electron IPC: refresh data when quick entry creates a card
  useEffect(() => {
    const handler = () => {
      fetchCards();
      if (activeProjectId) fetchDocuments(activeProjectId);
    };
    window.addEventListener("refresh-data", handler);
    return () => window.removeEventListener("refresh-data", handler);
  }, [fetchCards, fetchDocuments, activeProjectId]);

  // Initial fetch
  useEffect(() => {
    fetchCards();
    fetchProjects();
    fetchSettings();
    fetchSkills();
    fetchMcps();
    initTeam();
  }, [fetchCards, fetchProjects, fetchSettings, fetchSkills, fetchMcps, initTeam]);

  // Polling: Refresh data every 10 seconds (skip when modal/editor is open to prevent form reset)
  useEffect(() => {
    if (isModalOpen || isDocumentEditorOpen) return;

    const interval = setInterval(() => {
      fetchCards();
      fetchSkills();
      fetchMcps();
      if (activeProjectId) {
        fetchDocuments(activeProjectId);
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [fetchCards, fetchSkills, fetchMcps, fetchDocuments, activeProjectId, isModalOpen, isDocumentEditorOpen]);

  // Focus refresh: Refresh when tab becomes visible (skip when modal/editor is open)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && !isModalOpen && !isDocumentEditorOpen) {
        fetchCards();
        fetchSkills();
        fetchMcps();
        if (activeProjectId) {
          fetchDocuments(activeProjectId);
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [fetchCards, fetchSkills, fetchMcps, fetchDocuments, activeProjectId, isModalOpen, isDocumentEditorOpen]);

  // Get active project name for display
  const activeProject = projects.find((p) => p.id === activeProjectId);

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="border-b border-border px-6 py-4 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-foreground">
                {activeProject ? activeProject.name : "ideafy"}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {activeProject
                  ? `${activeProject.idPrefix} - ${activeProject.folderPath}`
                  : "All projects - Development workflow management"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Board/Pool Toggle - only when team mode is on */}
              {teamMode && (
                <div className="flex border border-border rounded-md overflow-hidden">
                  <Button
                    variant={viewMode === "board" ? "secondary" : "ghost"}
                    size="sm"
                    className="rounded-none gap-1.5 h-8 px-3"
                    onClick={() => setViewMode("board")}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                    Board
                  </Button>
                  <Button
                    variant={viewMode === "pool" ? "secondary" : "ghost"}
                    size="sm"
                    className="rounded-none gap-1.5 h-8 px-3"
                    onClick={() => setViewMode("pool")}
                  >
                    <Table2 className="h-3.5 w-3.5" />
                    Pool
                  </Button>
                </div>
              )}

              {/* Search */}
              <div className="relative">
                <Input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search tasks..."
                  className="w-56 pl-9"
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              </div>

              {/* Background Processes */}
              <BackgroundProcesses />

              {/* Keyboard hints */}
              <span className="text-xs text-muted-foreground hidden lg:block">
                <kbd className="px-1.5 py-0.5 bg-secondary border border-border rounded text-xs">
                  {"\u2318"}K
                </kbd>{" "}
                quick entry{" "}
                <kbd className="px-1.5 py-0.5 bg-secondary border border-border rounded text-xs ml-1">
                  N
                </kbd>{" "}
                new card
              </span>

              {/* Theme Toggle */}
              <ThemeToggle />

              {/* Backup Menu */}
              <BackupMenu />
            </div>
          </div>
        </header>

        {/* Board / Pool - only show loading on initial fetch, not on polling */}
        {isLoading && cards.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        ) : viewMode === "pool" && teamMode ? (
          <PoolView />
        ) : (
          <KanbanBoard />
        )}
      </main>

      {/* Modals */}
      {isModalOpen && <CardModal />}
      {isDocumentEditorOpen && <DocumentEditor />}
    </div>
  );
}
