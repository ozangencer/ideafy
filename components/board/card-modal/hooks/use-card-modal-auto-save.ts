"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AiPlatform, Card, Complexity, Priority, Project, Status } from "@/lib/types";

interface UseCardModalAutoSaveOptions {
  selectedCard: Card | null;
  isDraftMode: boolean;
  canSave: boolean;
  hasUnsavedChanges: boolean;
  title: string;
  description: string;
  solutionSummary: string;
  testScenarios: string;
  aiOpinion: string;
  status: Status;
  complexity: Complexity;
  priority: Priority;
  projectId: string | null;
  aiPlatform: AiPlatform | null;
  projects: Project[];
  updateCard: (id: string, updates: Partial<Card>) => Promise<void>;
}

export function useCardModalAutoSave(options: UseCardModalAutoSaveOptions) {
  const {
    selectedCard,
    isDraftMode,
    canSave,
    hasUnsavedChanges,
    title,
    description,
    solutionSummary,
    testScenarios,
    aiOpinion,
    status,
    complexity,
    priority,
    projectId,
    aiPlatform,
    projects,
    updateCard,
  } = options;

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const savedTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Guard: skip auto-save briefly after an external (e.g. MCP tool) update arrives
  const lastMcpUpdateRef = useRef<number>(0);
  // Guard: prevent formReset effect from clobbering form state during an auto-save round-trip
  const autoSaveInFlightRef = useRef(false);

  useEffect(() => {
    if (!selectedCard || isDraftMode || !canSave || !hasUnsavedChanges) {
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      if (Date.now() - lastMcpUpdateRef.current < 1000) {
        return;
      }

      setSaveStatus("saving");

      const selectedProject = projects.find((p) => p.id === projectId);

      autoSaveInFlightRef.current = true;
      updateCard(selectedCard.id, {
        title,
        description,
        solutionSummary,
        testScenarios,
        aiOpinion,
        status,
        complexity,
        priority,
        projectId,
        aiPlatform,
        projectFolder: selectedProject?.folderPath || selectedCard.projectFolder,
      }).finally(() => {
        setTimeout(() => {
          autoSaveInFlightRef.current = false;
        }, 200);
      });

      setSaveStatus("saved");

      if (savedTimeoutRef.current) {
        clearTimeout(savedTimeoutRef.current);
      }
      savedTimeoutRef.current = setTimeout(() => {
        setSaveStatus("idle");
      }, 2000);
    }, 500);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [
    selectedCard,
    isDraftMode,
    canSave,
    hasUnsavedChanges,
    title,
    description,
    solutionSummary,
    testScenarios,
    aiOpinion,
    status,
    complexity,
    priority,
    projectId,
    aiPlatform,
    projects,
    updateCard,
  ]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    };
  }, []);

  const cancelPendingAutoSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
      setSaveStatus("idle");
    }
  }, []);

  const markExternalUpdate = useCallback(() => {
    lastMcpUpdateRef.current = Date.now();
  }, []);

  return {
    saveStatus,
    cancelPendingAutoSave,
    markExternalUpdate,
    autoSaveInFlightRef,
  };
}
