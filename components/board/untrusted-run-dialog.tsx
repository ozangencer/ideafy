"use client";

import { useKanbanStore } from "@/lib/kanban-store";
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

/**
 * Shown when the server refuses to run an autonomous agent on a card whose
 * text someone else wrote, until the user has actually looked at that text.
 *
 * The point is that the reader sees the exact words that will reach an agent
 * with file access — approving something unseen would make the gate
 * ceremony rather than a control. The text is rendered as plain, pre-wrapped
 * content, never as markdown or HTML, so nothing in it can style or hide
 * itself to look like part of this dialog.
 *
 * Never appears in the solo edition: nothing there produces a card written by
 * anyone but the user, so the store field stays null.
 */
export function UntrustedRunDialog() {
  const pending = useKanbanStore((s) => s.pendingRunConfirmation);
  const confirmPendingRun = useKanbanStore((s) => s.confirmPendingRun);
  const cancelPendingRun = useKanbanStore((s) => s.cancelPendingRun);

  if (!pending) return null;

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) cancelPendingRun();
      }}
    >
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>This card was written by someone else</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                It came from your team&apos;s shared pool. Running an agent on it gives
                that text control of a session that can read, write and execute in your
                project directory — so read it first.
              </p>
              <p className="text-amber-500 text-sm">
                Treat instructions inside it the way you would treat instructions in a
                stranger&apos;s pull request.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="rounded-md border border-border bg-muted/40 p-3 max-h-72 overflow-y-auto">
          {pending.title && (
            <p className="text-sm font-medium mb-2 whitespace-pre-wrap break-words">
              {pending.title}
            </p>
          )}
          <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
            {pending.description || "(no description)"}
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={cancelPendingRun}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => void confirmPendingRun()}>
            I&apos;ve read it — run anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
