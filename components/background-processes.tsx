"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useKanbanStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { notifyFinishedRuns } from "@/lib/system-notifications";
import { firstLine } from "@/lib/run-error";
import { processBaseLabel, processRowLabel, processTimeHint } from "@/lib/process-labels";
import { RunErrorDetails, RunErrorToggle } from "@/components/run-error-details";
import { OrphanServerRow } from "@/components/orphan-server-row";
import type { BackgroundProcess, OrphanServer, ProcessType } from "@/lib/types";

// Colour per process type; the row text comes from processRowLabel.
const PROCESS_TYPE_CONFIG: Record<ProcessType, { color: string; bgColor: string }> = {
  chat: { color: "text-ink", bgColor: "bg-ink" },
  autonomous: { color: "text-ink", bgColor: "bg-ink" },
  "quick-fix": { color: "text-amber-500", bgColor: "bg-amber-500" },
  evaluate: { color: "text-cyan-500", bgColor: "bg-cyan-500" },
  generate: { color: "text-violet-500", bgColor: "bg-violet-500" },
};

// How often an open popover re-renders its elapsed / "ago" hints.
const TIME_HINT_TICK_MS = 15000;

// Orphan dev servers: scanned at launch and on this beat, not on the 10s
// heartbeat — a scan runs ps, lsof and footprint.
const ORPHAN_SCAN_MS = 10 * 60 * 1000;
// Rows shown before the "n more" toggle.
const ORPHAN_ROWS_VISIBLE = 5;

function ProcessItem({
  process,
  now,
  onKill,
  onCardClick,
  detailsOpen,
  onToggleDetails,
}: {
  process: BackgroundProcess;
  now: number;
  onKill: () => void;
  onCardClick: () => void;
  detailsOpen: boolean;
  onToggleDetails: () => void;
}) {
  const displayName = process.displayId || process.cardId.slice(0, 8);
  const processConfig = PROCESS_TYPE_CONFIG[process.processType];

  const isAborted = process.status === "completed" && process.endReason === "aborted";
  const isFailed = process.status === "completed" && process.endReason === "failed";
  const hasWarning = process.status === "completed" && !isAborted && !isFailed && !!process.warning;
  const error = isFailed ? process.error ?? null : null;

  // The phase and target column say which run this is; two runs of one card
  // otherwise both read "Autonomous". The warning text itself sits in the tooltip.
  const label = processRowLabel(process);
  const timeHint = processTimeHint(process, now);
  const tooltip = hasWarning && process.warning ? `${label}\n${process.warning}` : label;

  const handleKillClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card modal from opening
    onKill();
  };

  const dotClass = process.status === "running"
    ? `${processConfig.bgColor} animate-pulse`
    : isAborted || hasWarning
    ? "bg-amber-500"
    : process.status === "completed" && !isFailed
    ? "bg-green-500"
    : "bg-red-500";

  const subLabelClass = process.status === "running"
    ? processConfig.color
    : isAborted || hasWarning
    ? "text-amber-500"
    : isFailed
    ? "text-destructive"
    : "text-muted-foreground";

  return (
    <div
      className="flex items-start justify-between py-2 px-1 border-b border-border last:border-b-0 gap-2 cursor-pointer hover:bg-muted/50 rounded-sm transition-colors"
      onClick={onCardClick}
    >
      <div className="flex gap-2 min-w-0 flex-1">
        <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${dotClass}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs font-medium text-muted-foreground shrink-0">{displayName}</span>
            <span className="text-sm font-medium truncate">{process.cardTitle}</span>
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`text-xs truncate ${subLabelClass}`} title={tooltip}>
              {label}
            </span>
            {timeHint && (
              <span className="text-xs text-muted-foreground shrink-0">· {timeHint}</span>
            )}
            {error && <RunErrorToggle expanded={detailsOpen} onToggle={onToggleDetails} />}
          </div>
          {error && detailsOpen && <RunErrorDetails error={error} />}
        </div>
      </div>
      {process.status === "running" && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleKillClick}
          className="h-6 px-2 text-xs text-destructive hover:text-destructive shrink-0 mt-0.5"
        >
          Kill
        </Button>
      )}
    </div>
  );
}

export function BackgroundProcesses() {
  const {
    backgroundProcesses,
    fetchBackgroundProcesses,
    fetchQueue,
    fetchActivity,
    killBackgroundProcess,
    clearCompletedProcesses,
    clearProcessing,
    syncCardAfterRunEnd,
    cards,
    selectCard,
    openModal,
    settings,
    orphanServers,
    fetchOrphanServers,
    stopOrphanServer,
  } = useKanbanStore(
    useShallow((s) => ({
      backgroundProcesses: s.backgroundProcesses,
      fetchBackgroundProcesses: s.fetchBackgroundProcesses,
      fetchQueue: s.fetchQueue,
      fetchActivity: s.fetchActivity,
      killBackgroundProcess: s.killBackgroundProcess,
      clearCompletedProcesses: s.clearCompletedProcesses,
      clearProcessing: s.clearProcessing,
      syncCardAfterRunEnd: s.syncCardAfterRunEnd,
      cards: s.cards,
      selectCard: s.selectCard,
      openModal: s.openModal,
      settings: s.settings,
      orphanServers: s.orphanServers,
      fetchOrphanServers: s.fetchOrphanServers,
      stopOrphanServer: s.stopOrphanServer,
    }))
  );
  const [isOpen, setIsOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [openDetailIds, setOpenDetailIds] = useState<Set<string>>(new Set());
  const [showAllOrphans, setShowAllOrphans] = useState(false);
  // An orphan row's confirm dialog is portalled outside the popover.
  const [orphanConfirmOpen, setOrphanConfirmOpen] = useState(false);
  const { toast } = useToast();

  const toggleDetails = (id: string) => {
    setOpenDetailIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  // A stack trace does not fit the narrow list; widen while one is open.
  const detailsVisible = backgroundProcesses.some((p) => openDetailIds.has(p.id) && !!p.error);

  // Track running processes to detect completion
  const runningProcessesRef = useRef<Map<string, BackgroundProcess>>(new Map());
  // Track killed process IDs to show correct toast
  const killedIdsRef = useRef<Set<string>>(new Set());

  // Separate running and completed processes
  const { runningProcesses, completedProcesses } = useMemo(() => {
    const running = backgroundProcesses.filter((p) => p.status === "running");
    // Sort completed by completedAt descending (newest first)
    const completed = backgroundProcesses
      .filter((p) => p.status === "completed")
      .sort((a, b) => {
        const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return bTime - aTime;
      });
    return { runningProcesses: running, completedProcesses: completed };
  }, [backgroundProcesses]);

  // Handle kill with tracking
  const handleKill = async (processId: string) => {
    killedIdsRef.current.add(processId);
    await killBackgroundProcess(processId);
  };

  // Handle clear completed
  const handleClearCompleted = async () => {
    await clearCompletedProcesses();
  };

  // Handle clicking on a process to open its card
  const handleCardClick = (cardId: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (card) {
      selectCard(card);
      openModal();
      setIsOpen(false); // Close the popover
    }
  };

  // Detect when processes complete and show toast
  useEffect(() => {
    const currentRunning = new Map(
      runningProcesses.map((p) => [p.id, p])
    );
    const previousRunning = runningProcessesRef.current;
    // The heartbeat returns running and completed lists together, so a
    // process that just left the running list is already in completed here,
    // carrying whatever warning its route handed to the registry.
    const completedById = new Map(completedProcesses.map((p) => [p.id, p]));

    // Find processes that were running but are now gone or completed
    previousRunning.forEach((process, id) => {
      if (!currentRunning.has(id)) {
        const displayName = process.displayId || process.cardId.slice(0, 8);

        // Clear processing state on the card so spinner stops.
        // Chat processes don't set card.processingType and may run concurrently
        // with non-chat flows on the same card — clearing would stomp those.
        const wasKilled = killedIdsRef.current.has(id);
        if (!wasKilled && process.processType !== "chat") {
          // A run whose fetch is still pending in this page refreshes the
          // card itself. One whose fetch was lost (reload mid-run, a run
          // started elsewhere) has only this path, and clearProcessing alone
          // leaves the open modal on its pre-run form. Read before clearing:
          // clearProcessing drops the card from these lists.
          const { startingCardIds, quickFixingCardIds, evaluatingCardIds } =
            useKanbanStore.getState();
          const handlerAlive =
            startingCardIds.includes(process.cardId) ||
            quickFixingCardIds.includes(process.cardId) ||
            evaluatingCardIds.includes(process.cardId);
          void clearProcessing(process.cardId).then(() => {
            if (!handlerAlive) void syncCardAfterRunEnd(process.cardId);
          });
        }

        if (wasKilled) {
          killedIdsRef.current.delete(id);
          toast({
            title: "Process Cancelled",
            description: `${processBaseLabel(process)} was stopped for ${displayName}`,
          });
        } else {
          // The completed entry carries endReason and warning; without it
          // the running one still names the phase.
          const completed = completedById.get(id);
          const warning = completed?.warning;
          const label = `${displayName}: ${processRowLabel(completed ?? { ...process, status: "completed", endReason: "completed" })}`;
          if (completed?.endReason === "failed") {
            toast({
              variant: "destructive",
              title: "Process Failed",
              description: completed.error ? `${label}: ${firstLine(completed.error)}` : label,
            });
          } else if (warning) {
            toast({
              variant: "warning",
              title: "Completed with a warning",
              description: `${label} — ${warning}`,
            });
          } else {
            toast({
              title: "Process Completed",
              description: label,
            });
          }
        }
      }
    });

    runningProcessesRef.current = currentRunning;
  }, [runningProcesses, completedProcesses, toast, clearProcessing, syncCardAfterRunEnd]);

  // OS banners work off completed entries, not off the running list above:
  // a run that starts and ends between two polls (MCP, another session, a
  // quick chat reply) is never seen running, and neither is one that ends
  // while this component remounts. Each completed entry is keyed by
  // id@completedAt, so the same chat tab finishing a second turn counts as a
  // new finish. The first list after launch only primes the set — runs that
  // ended before Ideafy opened get no banner.
  const seenCompletedRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    // The store's untouched initial list means no response has landed yet;
    // priming from it would banner every old entry on the first poll.
    if (backgroundProcesses === useKanbanStore.getInitialState().backgroundProcesses) return;

    const keys = completedProcesses.map((p) => `${p.id}@${p.completedAt ?? ""}`);
    const seen = seenCompletedRef.current;
    seenCompletedRef.current = new Set(keys);
    if (!seen) return;

    const finished = completedProcesses.filter((_, i) => !seen.has(keys[i]));
    if (finished.length === 0) return;

    // The bell polls on its own 30s cadence, so without this nudge the toast
    // lands and the bell stays empty until the next tick. The server writes
    // the activity row in the same step that marks the process completed, so
    // it is already there. Independent of the OS-banner setting below.
    void fetchActivity();

    // Deliberately no duration threshold (unlike the bell's 60s): a 20s chat
    // reply is worth knowing about when the window is in the background, and
    // main skips the banner entirely while the window is focused.
    if (settings?.systemNotifications === false) {
      console.debug("[notify] system notifications are off, skipping", finished.length, "finished run(s)");
      return;
    }
    notifyFinishedRuns(finished);
  }, [backgroundProcesses, completedProcesses, settings?.systemNotifications, fetchActivity]);

  // Always-on heartbeat poll: avoids a chicken-and-egg where local state says
  // "nothing running" but the server actually has a process (spawned via MCP,
  // another session, or after a page reload mid-run). Cheap: one request / 10s.
  useEffect(() => {
    fetchBackgroundProcesses();
    fetchQueue();
    const interval = setInterval(() => {
      fetchBackgroundProcesses();
      // Same beat: the queue moves when a run ends, which is what this poll sees.
      fetchQueue();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchBackgroundProcesses, fetchQueue]);

  useEffect(() => {
    fetchOrphanServers();
    const interval = setInterval(() => fetchOrphanServers(), ORPHAN_SCAN_MS);
    return () => clearInterval(interval);
  }, [fetchOrphanServers]);

  // Numbers the user is about to act on should be fresh, not up to 10 min old.
  useEffect(() => {
    if (isOpen) fetchOrphanServers(true);
  }, [isOpen, fetchOrphanServers]);

  const handleStopOrphan = async (server: OrphanServer) => {
    const ok = await stopOrphanServer(server.id);
    toast(
      ok
        ? { title: "Server closed", description: `${server.label}${server.port ? ` :${server.port}` : ""}` }
        : { variant: "destructive", title: "Could not close server", description: server.label }
    );
    return ok;
  };

  // Elapsed / "ago" hints only matter while someone is looking.
  useEffect(() => {
    if (!isOpen) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), TIME_HINT_TICK_MS);
    return () => clearInterval(interval);
  }, [isOpen]);

  const runningCount = runningProcesses.length;
  const completedCount = completedProcesses.length;
  const orphanCount = orphanServers.length;
  const hasStaleOrphan = orphanServers.some((s) => s.stale);
  const visibleOrphans = showAllOrphans
    ? orphanServers
    : orphanServers.slice(0, ORPHAN_ROWS_VISIBLE);

  // Don't render the button when nothing to show, but keep the component
  // mounted so polling continues.
  if (backgroundProcesses.length === 0 && orphanCount === 0) {
    return null;
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative h-9 w-9 p-0"
        >
          {/* Activity icon */}
          <svg
            className={`w-5 h-5 ${runningCount > 0 ? "text-ink" : "text-muted-foreground"}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          {/* Badge */}
          {runningCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-ink text-[10px] font-medium text-background flex items-center justify-center">
              {runningCount}
            </span>
          )}
          {/* A server open 12h+ that nobody owns */}
          {hasStaleOrphan && (
            <span
              className={`absolute ${runningCount > 0 ? "-bottom-0.5" : "-top-0.5"} -right-0.5 h-2 w-2 rounded-full bg-amber-500`}
            />
          )}
          <span className="sr-only">Background processes</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className={`${detailsVisible ? "w-96" : "w-72"} p-0`}
        onInteractOutside={(e) => {
          if (orphanConfirmOpen) e.preventDefault();
        }}
      >
        <div className="p-3 border-b border-border flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium">Background Processes</h4>
            <p className="text-xs text-muted-foreground">
              {runningCount} running, {completedCount} completed
              {orphanCount > 0 && `, ${orphanCount} orphan`}
            </p>
          </div>
          {completedCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearCompleted}
              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </Button>
          )}
        </div>
        <div className={`${detailsVisible ? "max-h-96" : "max-h-64"} overflow-y-auto p-2`}>
          {/* Running processes first */}
          {runningProcesses.map((process) => (
            <ProcessItem
              key={process.id}
              process={process}
              now={now}
              onKill={() => handleKill(process.id)}
              onCardClick={() => handleCardClick(process.cardId)}
              detailsOpen={openDetailIds.has(process.id)}
              onToggleDetails={() => toggleDetails(process.id)}
            />
          ))}
          {/* Separator if both running and completed exist */}
          {runningCount > 0 && completedCount > 0 && (
            <div className="my-2 border-t border-border" />
          )}
          {/* Completed processes */}
          {completedProcesses.map((process) => (
            <ProcessItem
              key={process.id}
              process={process}
              now={now}
              onKill={() => handleKill(process.id)}
              onCardClick={() => handleCardClick(process.cardId)}
              detailsOpen={openDetailIds.has(process.id)}
              onToggleDetails={() => toggleDetails(process.id)}
            />
          ))}
          {/* Dev servers nobody owns: left by an AI verification, a terminal, an old Stop */}
          {orphanCount > 0 && (
            <>
              {backgroundProcesses.length > 0 && <div className="my-2 border-t border-border" />}
              <div className="px-1 pb-1 text-xs font-medium text-muted-foreground">
                Orphan servers
              </div>
              {visibleOrphans.map((server) => (
                <OrphanServerRow
                  key={server.id}
                  server={server}
                  now={now}
                  onStop={() => handleStopOrphan(server)}
                  onCardClick={server.cardId ? () => handleCardClick(server.cardId!) : undefined}
                  onConfirmOpenChange={setOrphanConfirmOpen}
                />
              ))}
              {orphanCount > ORPHAN_ROWS_VISIBLE && (
                <button
                  type="button"
                  onClick={() => setShowAllOrphans((v) => !v)}
                  className="w-full px-1 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
                >
                  {showAllOrphans ? "Show less" : `${orphanCount - ORPHAN_ROWS_VISIBLE} more`}
                </button>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
