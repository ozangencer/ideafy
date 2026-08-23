"use client";

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
 * The paste tip that stands between a button and an interactive session.
 *
 * It exists for one terminal: Ghostty swallows ⌘V unless you know to use it,
 * and a session that opens with a prompt you cannot paste into is worse than
 * one that never opened. Everywhere else the button runs straight through —
 * `needsPasteTip` is the gate, and it is deliberately a function rather than a
 * prop each caller re-derives.
 *
 * One component for every such dialog, because the tip is the same sentence
 * each time and the only reason a second copy would ever differ is that
 * someone edited one and missed the other.
 */

export function getEffectiveTerminal(
  settings: { terminalApp?: string | null; detectedTerminal?: string | null } | null | undefined
): string | null {
  return settings?.terminalApp ?? settings?.detectedTerminal ?? null;
}

export function getPasteTipTerminalLabel(terminal: string | null): string {
  if (terminal === "ghostty") return "Ghostty";
  if (terminal === "cmux") return "cmux";
  if (terminal === "warp") return "Warp";
  if (terminal === "iterm2") return "iTerm2";
  if (terminal === "terminal") return "Terminal";
  return "terminal";
}

/** Whether opening a session here should stop for the tip first. */
export function needsPasteTip(
  settings: { terminalApp?: string | null; detectedTerminal?: string | null } | null | undefined
): boolean {
  return getEffectiveTerminal(settings) === "ghostty";
}

interface PasteTipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Said before the tip, when the dialog has to explain what it is starting. */
  lead?: string;
  terminalLabel: string;
  confirmLabel: string;
  /** Keeps each button the colour of the icon that opened it. */
  confirmClassName?: string;
  onConfirm: () => void;
  /** Extra context under the tip — e.g. which worktree the session will land in. */
  children?: React.ReactNode;
}

export function PasteTipDialog({
  open,
  onOpenChange,
  title,
  lead,
  terminalLabel,
  confirmLabel,
  confirmClassName,
  onConfirm,
  children,
}: PasteTipDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {lead && <p>{lead}</p>}
              <p>
                <strong>Tip:</strong> Use{" "}
                <kbd className="px-1.5 py-0.5 bg-secondary border border-border rounded text-xs">
                  ⌘V
                </kbd>{" "}
                to paste in {terminalLabel}.
              </p>
              {children}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className={confirmClassName}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
