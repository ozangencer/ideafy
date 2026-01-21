"use client";

import { useEffect, useState, useRef } from "react";
import { useKanbanStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SECTION_CONFIG } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import type { BackgroundProcess } from "@/lib/types";

function ProcessItem({
  process,
  onKill,
}: {
  process: BackgroundProcess;
  onKill: () => void;
}) {
  const sectionConfig = SECTION_CONFIG[process.sectionType];
  const displayName = process.displayId || process.cardId.slice(0, 8);

  return (
    <div className="flex items-center justify-between py-2 px-1 border-b border-border last:border-b-0">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`w-2 h-2 rounded-full ${
            process.status === "running"
              ? "bg-blue-500 animate-pulse"
              : process.status === "completed"
              ? "bg-green-500"
              : "bg-red-500"
          }`}
        />
        <span className="text-sm font-medium truncate">{displayName}</span>
        <span className="text-xs text-muted-foreground">
          {sectionConfig?.label || process.sectionType}
        </span>
      </div>
      {process.status === "running" && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onKill}
          className="h-6 px-2 text-xs text-destructive hover:text-destructive"
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
  } = useKanbanStore();
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();

  // Track running process IDs to detect completion
  const runningIdsRef = useRef<Set<string>>(new Set());

  // Detect when processes complete and show toast
  useEffect(() => {
    const currentRunningIds = new Set(
      backgroundProcesses.filter((p) => p.status === "running").map((p) => p.id)
    );
    const previousRunningIds = runningIdsRef.current;

    // Find processes that were running but are now gone (completed)
    previousRunningIds.forEach((id) => {
      if (!currentRunningIds.has(id)) {
        // Process completed - find its info from previous state
        const [cardId, sectionType] = id.split("-");
        const sectionLabel = SECTION_CONFIG[sectionType as keyof typeof SECTION_CONFIG]?.label || sectionType;
        toast({
          title: "Process Completed",
          description: `Chat ${sectionLabel.toLowerCase()} finished for ${cardId.slice(0, 8)}`,
        });
      }
    });

    runningIdsRef.current = currentRunningIds;
  }, [backgroundProcesses, toast]);

  // Polling: refresh processes every 3 seconds when popover is open or there are running processes
  useEffect(() => {
    // Initial fetch
    fetchBackgroundProcesses();

    const hasRunning = backgroundProcesses.some((p) => p.status === "running");
    if (!hasRunning && !isOpen) return;

    const interval = setInterval(() => {
      fetchBackgroundProcesses();
    }, 3000);

    return () => clearInterval(interval);
  }, [fetchBackgroundProcesses, isOpen, backgroundProcesses.length]);

  const runningCount = backgroundProcesses.filter(
    (p) => p.status === "running"
  ).length;

  // Don't render anything if no processes
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
        <div className="p-3 border-b border-border">
          <h4 className="text-sm font-medium">Background Processes</h4>
          <p className="text-xs text-muted-foreground">
            {runningCount} running, {backgroundProcesses.length - runningCount} completed
          </p>
        </div>
        <div className="max-h-64 overflow-y-auto p-2">
          {backgroundProcesses.map((process) => (
            <ProcessItem
              key={process.id}
              process={process}
              onKill={() => killBackgroundProcess(process.id)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
