"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useKanbanStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SECTION_CONFIG } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { notifyFinishedRuns } from "@/lib/system-notifications";
import { firstLine } from "@/lib/run-error";
import { RunErrorDetails, RunErrorToggle } from "@/components/run-error-details";
import type { BackgroundProcess, ProcessType } from "@/lib/types";

// Process type config for display
const PROCESS_TYPE_CONFIG: Record<ProcessType, { label: string; color: string; bgColor: string }> = {
  chat: { label: "Chat", color: "text-ink", bgColor: "bg-ink" },
  autonomous: { label: "Autonomous", color: "text-ink", bgColor: "bg-ink" },
  "quick-fix": { label: "Quick Fix", color: "text-amber-500", bgColor: "bg-amber-500" },
  evaluate: { label: "Evaluate", color: "text-cyan-500", bgColor: "bg-cyan-500" },
  generate: { label: "Generate", color: "text-violet-500", bgColor: "bg-violet-500" },
};

/** Short popover suffix for a run that finished with a warning. */
function warningSuffix(warning: string): string {
  return /checklist left untouched/i.test(warning) ? "Checklist untouched" : "Check output";
}

function ProcessItem({
  process,
  onKill,
  onCardClick,
  detailsOpen,
  onToggleDetails,
}: {
  process: BackgroundProcess;
  onKill: () => void;
  onCardClick: () => void;
  detailsOpen: boolean;
  onToggleDetails: () => void;
}) {
  const displayName = process.displayId || process.cardId.slice(0, 8);
  const processConfig = PROCESS_TYPE_CONFIG[process.processType];
  const sectionConfig = process.sectionType ? SECTION_CONFIG[process.sectionType] : null;

  const isAborted = process.status === "completed" && process.endReason === "aborted";
  const isFailed = process.status === "completed" && process.endReason === "failed";
  const hasWarning = process.status === "completed" && !isAborted && !isFailed && !!process.warning;
  const error = isFailed ? process.error ?? null : null;

  // Build label: for chat include section name, for others show process type.
  // Append an "· Interrupted on reload" suffix for aborted entries so users
  // can tell a reload-killed chat apart from a cleanly finished one, and a
  // warning suffix so a run that left the card as it was doesn't read as done.
  const baseLabel = process.processType === "chat" && sectionConfig
    ? `Chat (${sectionConfig.label.toLowerCase()})`
    : processConfig.label;
  const label = isAborted
    ? `${baseLabel} · Interrupted on reload`
    : isFailed
    ? `${baseLabel} · Failed`
    : hasWarning
    ? `${baseLabel} · ${warningSuffix(process.warning!)}`
    : baseLabel;

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
          <div className="flex items-center gap-1.5">
            <span
              className={`text-xs ${subLabelClass}`}
              title={hasWarning ? process.warning ?? undefined : undefined}
            >
              {label}
            </span>
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
  } = useKanbanStore();
  const [isOpen, setIsOpen] = useState(false);
  const [openDetailIds, setOpenDetailIds] = useState<Set<string>>(new Set());
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
        const processConfig = PROCESS_TYPE_CONFIG[process.processType];
        const sectionConfig = process.sectionType ? SECTION_CONFIG[process.sectionType] : null;

        const label = process.processType === "chat" && sectionConfig
          ? `Chat (${sectionConfig.label.toLowerCase()})`
          : processConfig.label;

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
            description: `${label} was stopped for ${displayName}`,
          });
        } else {
          const completed = completedById.get(id);
          const warning = completed?.warning;
          if (completed?.endReason === "failed") {
            toast({
              variant: "destructive",
              title: "Process Failed",
              description: completed.error
                ? `${label} failed for ${displayName}: ${firstLine(completed.error)}`
                : `${label} failed for ${displayName}`,
            });
          } else if (warning) {
            toast({
              variant: "warning",
              title: "Completed with a warning",
              description: `${displayName}: ${warning}`,
            });
          } else {
            toast({
              title: "Process Completed",
              description: `${label} finished for ${displayName}`,
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

  const runningCount = runningProcesses.length;
  const completedCount = completedProcesses.length;

  // Don't render the button when nothing to show, but keep the component
  // mounted so polling continues.
  if (backgroundProcesses.length === 0) {
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
          <span className="sr-only">Background processes</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className={`${detailsVisible ? "w-96" : "w-72"} p-0`}>
        <div className="p-3 border-b border-border flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium">Background Processes</h4>
            <p className="text-xs text-muted-foreground">
              {runningCount} running, {completedCount} completed
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
              onKill={() => handleKill(process.id)}
              onCardClick={() => handleCardClick(process.cardId)}
              detailsOpen={openDetailIds.has(process.id)}
              onToggleDetails={() => toggleDetails(process.id)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
