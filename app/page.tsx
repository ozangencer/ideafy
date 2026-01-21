"use client";

import { useEffect } from "react";
import { Sidebar } from "@/components/sidebar/sidebar";
import { KanbanBoard } from "@/components/board/kanban-board";
import { CardModal } from "@/components/board/card-modal";
import { DocumentEditor } from "@/components/editor/document-editor";
import { ThemeToggle } from "@/components/theme-toggle";
import { BackupMenu } from "@/components/backup-menu";
import { useKanbanStore } from "@/lib/store";
import { useKeyboardShortcuts } from "@/lib/use-keyboard-shortcuts";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

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
  } = useKanbanStore();

  useKeyboardShortcuts();

  // Initial fetch
  useEffect(() => {
    fetchCards();
    fetchProjects();
    fetchSettings();
    fetchSkills();
    fetchMcps();
  }, [fetchCards, fetchProjects, fetchSettings, fetchSkills, fetchMcps]);

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

              {/* Keyboard hint */}
              <span className="text-xs text-muted-foreground hidden lg:block">
                Press{" "}
                <kbd className="px-1.5 py-0.5 bg-secondary border border-border rounded text-xs">
                  N
                </kbd>{" "}
                for new
              </span>

              {/* Theme Toggle */}
              <ThemeToggle />

              {/* Backup Menu */}
              <BackupMenu />
            </div>
          </div>
        </header>

        {/* Board - only show loading on initial fetch, not on polling */}
        {isLoading && cards.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-muted-foreground">Loading...</p>
          </div>
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
