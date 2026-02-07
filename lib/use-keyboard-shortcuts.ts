import { useEffect } from "react";
import { useKanbanStore } from "./store";

export function useKeyboardShortcuts() {
  const {
    openNewCardModal,
    isModalOpen,
    closeModal,
    toggleSidebar,
    activeProjectId,
    isQuickEntryOpen,
    toggleQuickEntry,
    closeQuickEntry,
  } = useKanbanStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+Shift+K / Ctrl+Shift+K - Toggle quick entry (fires from any context, even inputs)
      if (e.key === "k" && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault();
        if (!isModalOpen) {
          toggleQuickEntry();
        }
        return;
      }

      // Esc - Close quick entry if open
      if (e.key === "Escape" && isQuickEntryOpen) {
        closeQuickEntry();
        return;
      }

      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }

      // Esc - Close modal (handled in card-modal.tsx, but also here as fallback)
      if (e.key === "Escape" && isModalOpen) {
        closeModal();
        return;
      }

      // [ or ] - Toggle sidebar
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // N - New card in backlog and open panel
      if (e.key === "n" || e.key === "N") {
        if (!isModalOpen) {
          e.preventDefault();
          openNewCardModal("backlog", activeProjectId);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openNewCardModal, isModalOpen, closeModal, toggleSidebar, activeProjectId, isQuickEntryOpen, toggleQuickEntry, closeQuickEntry]);
}
