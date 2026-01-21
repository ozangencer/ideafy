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

// Global registry for active processes
const processRegistry = new Map<string, ProcessEntry>();

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

  return processes;
}
