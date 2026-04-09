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
import type { BackgroundProcess, ProcessType } from "@/lib/types";

// Process type config for display
const PROCESS_TYPE_CONFIG: Record<ProcessType, { label: string; color: string; bgColor: string }> = {
  chat: { label: "Chat", color: "text-blue-500", bgColor: "bg-blue-500" },
  autonomous: { label: "Autonomous", color: "text-purple-500", bgColor: "bg-purple-500" },
  "quick-fix": { label: "Quick Fix", color: "text-amber-500", bgColor: "bg-amber-500" },
  evaluate: { label: "Evaluate", color: "text-cyan-500", bgColor: "bg-cyan-500" },
};

function ProcessItem({
  process,
  onKill,
  onCardClick,
}: {
  process: BackgroundProcess;
  onKill: () => void;
  onCardClick: () => void;
}) {
  const displayName = process.displayId || process.cardId.slice(0, 8);
  const processConfig = PROCESS_TYPE_CONFIG[process.processType];
  const sectionConfig = process.sectionType ? SECTION_CONFIG[process.sectionType] : null;

  // Build label: for chat show section, for others show process type
  const label = process.processType === "chat" && sectionConfig
    ? sectionConfig.label
    : processConfig.label;

  const handleKillClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card modal from opening
    onKill();
  };

  return (
    <div
      className="flex items-start justify-between py-2 px-1 border-b border-border last:border-b-0 gap-2 cursor-pointer hover:bg-muted/50 rounded-sm transition-colors"
      onClick={onCardClick}
    >
      <div className="flex gap-2 min-w-0 flex-1">
        <span
          className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${
            process.status === "running"
              ? `${processConfig.bgColor} animate-pulse`
              : process.status === "completed"
              ? "bg-green-500"
              : "bg-red-500"
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs font-medium text-muted-foreground shrink-0">{displayName}</span>
            <span className="text-sm font-medium truncate">{process.cardTitle}</span>
          </div>
          <span className={`text-xs ${process.status === "running" ? processConfig.color : "text-muted-foreground"}`}>
            {label}
          </span>
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
    killBackgroundProcess,
    clearCompletedProcesses,
    cards,
    selectCard,
    openModal,
  } = useKanbanStore();
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();

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

    // Find processes that were running but are now gone or completed
    previousRunning.forEach((process, id) => {
      if (!currentRunning.has(id)) {
        const displayName = process.displayId || process.cardId.slice(0, 8);
        const processConfig = PROCESS_TYPE_CONFIG[process.processType];
        const sectionConfig = process.sectionType ? SECTION_CONFIG[process.sectionType] : null;

        const label = process.processType === "chat" && sectionConfig
          ? `Chat (${sectionConfig.label.toLowerCase()})`
          : processConfig.label;

        // Check if this process was killed
        const wasKilled = killedIdsRef.current.has(id);
        if (wasKilled) {
          killedIdsRef.current.delete(id);
          toast({
            title: "Process Cancelled",
            description: `${label} was stopped for ${displayName}`,
          });
        } else {
          toast({
            title: "Process Completed",
            description: `${label} finished for ${displayName}`,
          });
        }
      }
    });

    runningProcessesRef.current = currentRunning;
  }, [runningProcesses, toast]);

  // Poll only when there are running processes
  const hasRunning = backgroundProcesses.some((p) => p.status === "running");

  useEffect(() => {
    // Initial fetch
    fetchBackgroundProcesses();
  }, [fetchBackgroundProcesses]);

  useEffect(() => {
    if (!hasRunning) return;

    const interval = setInterval(() => {
      fetchBackgroundProcesses();
    }, 5000);

    return () => clearInterval(interval);
  }, [hasRunning, fetchBackgroundProcesses]);

  const runningCount = runningProcesses.length;
  const completedCount = completedProcesses.length;

  // Don't render the button if no processes, but keep component mounted for polling
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
            className={`w-5 h-5 ${runningCount > 0 ? "text-blue-500" : "text-muted-foreground"}`}
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
            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-blue-500 text-[10px] font-medium text-white flex items-center justify-center">
              {runningCount}
            </span>
          )}
          <span className="sr-only">Background processes</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
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
        <div className="max-h-64 overflow-y-auto p-2">
          {/* Running processes first */}
          {runningProcesses.map((process) => (
            <ProcessItem
              key={process.id}
              process={process}
              onKill={() => handleKill(process.id)}
              onCardClick={() => handleCardClick(process.cardId)}
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
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
