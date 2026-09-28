"use client";

import { useEffect } from "react";
import { ArrowRightLeft, ChevronDown, Trash2, X } from "lucide-react";
import { useKanbanStore } from "@/lib/store";
import { getColumns, STATUS_COLORS } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const isMac = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

// Same stand-down rule as the Cmd+Z hook: a text field keeps its own Esc and
// Backspace, and an open dialog, menu or card panel owns the keyboard.
function keyboardBelongsElsewhere(target: EventTarget | null, isModalOpen: boolean) {
  const el = target as HTMLElement | null;
  if (
    el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      el.isContentEditable)
  ) {
    return true;
  }
  return (
    isModalOpen ||
    !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')
  );
}

/**
 * The floating bar for a board multi-selection: how many are picked, where to
 * move them, delete, and a way out. Esc clears the selection and ⌫ opens the
 * delete confirmation — the same one a card's context menu opens.
 */
export function SelectionBar() {
  const selectedCardIds = useKanbanStore((s) => s.selectedCardIds);
  const activeWorkspace = useKanbanStore((s) => s.activeWorkspace);
  const isModalOpen = useKanbanStore((s) => s.isModalOpen);
  const isConfirmOpen = useKanbanStore((s) => s.isBulkDeleteConfirmOpen);
  const setConfirmOpen = useKanbanStore((s) => s.setBulkDeleteConfirmOpen);
  const clearCardSelection = useKanbanStore((s) => s.clearCardSelection);
  const moveCards = useKanbanStore((s) => s.moveCards);
  const deleteCards = useKanbanStore((s) => s.deleteCards);

  const count = selectedCardIds.length;
  const hasSelection = count > 0;

  useEffect(() => {
    if (!hasSelection) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "Escape" && e.key !== "Backspace" && e.key !== "Delete") return;
      if (keyboardBelongsElsewhere(e.target, isModalOpen)) return;
      e.preventDefault();
      if (e.key === "Escape") clearCardSelection();
      else setConfirmOpen(true);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasSelection, isModalOpen, clearCardSelection, setConfirmOpen]);

  if (!hasSelection) return null;

  const noun = count === 1 ? "card" : "cards";
  const undoShortcut = isMac() ? "⌘Z" : "Ctrl+Z";

  return (
    <>
      <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1.5 shadow-2xl">
        <span className="px-2 text-xs font-medium tabular-nums text-foreground">
          {count} selected
        </span>
        <div className="h-4 w-px bg-border" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5">
              <ArrowRightLeft />
              Move to
              <ChevronDown className="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center" className="w-40">
            {getColumns(activeWorkspace).map((col) => (
              <DropdownMenuItem
                key={col.id}
                onClick={() => void moveCards(selectedCardIds, col.id)}
              >
                <span className={`mr-2 h-2 w-2 rounded-full ${STATUS_COLORS[col.id]}`} />
                {col.title}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConfirmOpen(true)}
          className="gap-1.5 text-red-500 hover:text-red-500"
        >
          <Trash2 />
          Delete
        </Button>
        <div className="h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="sm"
          onClick={clearCardSelection}
          aria-label="Clear selection (Esc)"
          title="Clear selection (Esc)"
          className="px-2"
        >
          <X />
        </Button>
      </div>

      <AlertDialog open={isConfirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {count} {noun}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              You can undo with {undoShortcut}. Cards with a run in progress are skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void deleteCards(selectedCardIds)}
              className="bg-red-500 hover:bg-red-600"
            >
              Delete {count} {noun}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
