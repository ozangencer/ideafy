"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type { OrphanServer } from "@/lib/types";

export function formatFootprint(bytes: number | null): string {
  if (bytes == null) return "–";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

export function formatAge(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h >= 10) return `${h}h`;
  if (h > 0) return m ? `${h}h ${m}m` : `${h}h`;
  return `${Math.max(m, 1)}m`;
}

function timeLeft(deadline: string, now: number): string {
  const sec = Math.max(0, Math.round((new Date(deadline).getTime() - now) / 1000));
  return formatAge(sec);
}

export function OrphanServerRow({
  server,
  now,
  onStop,
  onCardClick,
  onConfirmOpenChange,
}: {
  server: OrphanServer;
  now: number;
  /** Resolves true once the server is closed. */
  onStop: () => Promise<boolean>;
  onCardClick?: () => void;
  /** The dialog is portalled; the popover must not close while it is open. */
  onConfirmOpenChange: (open: boolean) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [stopping, setStopping] = useState(false);

  const setOpen = (open: boolean) => {
    setConfirmOpen(open);
    onConfirmOpenChange(open);
  };

  const handleConfirm = async (e: React.MouseEvent) => {
    // Keep the dialog up until the processes are actually gone.
    e.preventDefault();
    setStopping(true);
    await onStop();
    setStopping(false);
    setOpen(false);
  };

  const memory = formatFootprint(server.memoryBytes);
  const port = server.port ? `:${server.port}` : null;
  const sub = server.verifyDeadline
    ? `verify · ${timeLeft(server.verifyDeadline, now)} left`
    : formatAge(server.ageSec);
  const tooltip = [server.cwd, `pgid ${server.pgid}`].filter(Boolean).join("\n");

  return (
    <div
      className={`flex items-start justify-between py-2 px-1 border-b border-border last:border-b-0 gap-2 rounded-sm transition-colors ${
        onCardClick ? "cursor-pointer hover:bg-muted/50" : ""
      }`}
      onClick={onCardClick}
      title={tooltip}
    >
      <div className="flex gap-2 min-w-0 flex-1">
        <span
          className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${
            server.stale ? "bg-amber-500" : "bg-muted-foreground/50"
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-medium truncate">{server.label}</span>
            {port && <span className="text-xs text-muted-foreground shrink-0">{port}</span>}
          </div>
          <div className="flex items-center gap-1.5 min-w-0 text-xs text-muted-foreground">
            <span className="shrink-0 tabular-nums">{memory}</span>
            <span className="shrink-0">· {sub}</span>
            {server.stale && (
              <span className="inline-flex items-center gap-1 text-amber-500 shrink-0">
                <AlertTriangle className="h-3 w-3" />
                open 12h+
              </span>
            )}
          </div>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation(); // Prevent card modal from opening
          setOpen(true);
        }}
        className="h-6 px-2 text-xs text-destructive hover:text-destructive shrink-0 mt-0.5"
      >
        Close
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !stopping && setOpen(open)}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Close {server.label}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {port ? `Port ${server.port}` : "No listening port"} · {memory} ·
                  open {formatAge(server.ageSec)}
                </p>
                {server.cwd && <p className="font-mono text-xs break-all">{server.cwd}</p>}
                <p>
                  Ideafy did not start this server. Another session or terminal
                  may still be using it — closing it stops every process in it.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={stopping}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={stopping}>
              {stopping ? "Closing…" : "Close server"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
