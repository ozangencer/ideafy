"use client";

import { useCallback, useEffect, useRef } from "react";
import { useKanbanStore } from "@/lib/store";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

// "Deleted X" → "Restored X", "Moved X to Backlog" → "Moved X back".
const describeUndone = (label: string) =>
  label.replace(/^Deleted /, "Restored ").replace(/^(Moved .+) to [^(]+/, "$1 back ").trim();

const isMac = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Board-level Cmd+Z (Ctrl+Z elsewhere) for card deletes and column moves, plus
 * the toast that announces each undoable action with an Undo button for anyone
 * who doesn't know the shortcut.
 *
 * Text fields keep the browser's own undo: the shortcut stands down whenever
 * focus is in an input, textarea or editor, or a dialog/the card panel is open.
 */
export function useUndoShortcut() {
  const undo = useKanbanStore((s) => s.undo);
  const undoStack = useKanbanStore((s) => s.undoStack);
  const isModalOpen = useKanbanStore((s) => s.isModalOpen);
  const lastAnnouncedId = useRef<string | null>(null);

  const runUndo = useCallback(async () => {
    const result = await undo();
    if (!result) {
      toast({ title: "Nothing to undo" });
      return;
    }
    if (result.error) {
      toast({
        variant: "destructive",
        title: "Couldn't undo",
        description: result.error,
      });
      return;
    }
    toast({ title: "Undone", description: describeUndone(result.entry.label) });
  }, [undo]);

  // Announce each new entry once. Undo pops the stack, which exposes an older
  // entry at the top — the age check keeps that one (and whatever is on top
  // when the board remounts) from being toasted a second time.
  const top = undoStack[undoStack.length - 1];
  useEffect(() => {
    if (!top || top.id === lastAnnouncedId.current) return;
    lastAnnouncedId.current = top.id;
    if (Date.now() - top.at > 2000) return;
    const shortcut = isMac() ? "⌘Z" : "Ctrl+Z";
    toast({
      title: top.label,
      description: `Press ${shortcut} to undo`,
      action: (
        <ToastAction altText={`Undo (${shortcut})`} onClick={() => void runUndo()}>
          Undo
        </ToastAction>
      ),
    });
  }, [top, runUndo]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "z" || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) {
        return;
      }
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (isModalOpen || document.querySelector('[role="dialog"], [role="alertdialog"]')) {
        return;
      }
      e.preventDefault();
      void runUndo();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isModalOpen, runUndo]);
}
