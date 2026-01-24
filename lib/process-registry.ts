import { ChildProcess } from "child_process";
import type { SectionType, ProcessType, BackgroundProcess } from "@/lib/types";

// Process metadata stored alongside the ChildProcess
interface ProcessEntry {
  process: ChildProcess;
  metadata: {
    cardId: string;
    sectionType: SectionType | null;
    processType: ProcessType;
    cardTitle: string;
    displayId: string | null;
    startedAt: string;
  };
}

// Completed process metadata (no ChildProcess ref)
interface CompletedEntry {
  id: string;
  cardId: string;
  sectionType: SectionType | null;
  processType: ProcessType;
  cardTitle: string;
  displayId: string | null;
  startedAt: string;
  completedAt: string;
}

// Global registry for active processes
const processRegistry = new Map<string, ProcessEntry>();

// Registry for completed processes (keeps last 5)
const completedProcessRegistry = new Map<string, CompletedEntry>();
const MAX_COMPLETED = 5;

export function registerProcess(
  processKey: string,
  process: ChildProcess,
  metadata: ProcessEntry["metadata"]
): void {
  processRegistry.set(processKey, { process, metadata });
}

export function unregisterProcess(processKey: string): void {
  processRegistry.delete(processKey);
}

// Move process from active to completed registry
export function completeProcess(processKey: string): void {
  const entry = processRegistry.get(processKey);
  if (entry) {
    // Add to completed registry with timestamp
    const completedEntry: CompletedEntry = {
      id: processKey,
      cardId: entry.metadata.cardId,
      sectionType: entry.metadata.sectionType,
      processType: entry.metadata.processType,
      cardTitle: entry.metadata.cardTitle,
      displayId: entry.metadata.displayId,
      startedAt: entry.metadata.startedAt,
      completedAt: new Date().toISOString(),
    };
    completedProcessRegistry.set(processKey, completedEntry);

    // Remove from active registry
    processRegistry.delete(processKey);

    // If completed registry exceeds max, remove oldest (FIFO)
    if (completedProcessRegistry.size > MAX_COMPLETED) {
      const entries = Array.from(completedProcessRegistry.entries());
      // Sort by completedAt ascending (oldest first)
      entries.sort((a, b) =>
        new Date(a[1].completedAt).getTime() - new Date(b[1].completedAt).getTime()
      );
      // Remove oldest
      completedProcessRegistry.delete(entries[0][0]);
    }
  }
}

// Clear all completed processes
export function clearCompletedProcesses(): void {
  completedProcessRegistry.clear();
}

export function getProcess(processKey: string): ProcessEntry | undefined {
  return processRegistry.get(processKey);
}

export function killProcess(processKey: string): boolean {
  const entry = processRegistry.get(processKey);
  if (entry) {
    entry.process.kill();
    processRegistry.delete(processKey);
    return true;
  }
  return false;
}

export function getAllProcesses(): BackgroundProcess[] {
  const processes: BackgroundProcess[] = [];

  // Add running processes
  processRegistry.forEach((entry, key) => {
    const isRunning = entry.process.pid && !entry.process.killed;
    processes.push({
      id: key,
      cardId: entry.metadata.cardId,
      sectionType: entry.metadata.sectionType,
      processType: entry.metadata.processType,
      cardTitle: entry.metadata.cardTitle,
      displayId: entry.metadata.displayId,
      pid: entry.process.pid || 0,
      status: isRunning ? "running" : "completed",
      startedAt: entry.metadata.startedAt,
    });
  });

  // Add completed processes
  completedProcessRegistry.forEach((entry) => {
    processes.push({
      id: entry.id,
      cardId: entry.cardId,
      sectionType: entry.sectionType,
      processType: entry.processType,
      cardTitle: entry.cardTitle,
      displayId: entry.displayId,
      pid: 0,
      status: "completed",
      startedAt: entry.startedAt,
      completedAt: entry.completedAt,
    });
  });

  return processes;
}
