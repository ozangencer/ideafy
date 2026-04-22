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
  /**
   * Extra fields merged into the auto-save payload. Evaluated lazily at
   * save time so consumers don't need to include these values in the
   * effect dep array. Cloud wrapper returns { assignedTo, assignedToName }.
   */
  extraFields?: () => Record<string, unknown>;
  /**
   * Suppress the auto-save effect when truthy. Evaluated at effect run
   * time. Cloud wrapper returns `() => isReadOnly` for pool-locked cards.
   */
  skipCondition?: () => boolean;
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
    extraFields,
    skipCondition,
  } = options;

  // Latest-value refs so option churn doesn't retrigger the debounce effect
  const extraFieldsRef = useRef(extraFields);
  const skipConditionRef = useRef(skipCondition);
  useEffect(() => {
    extraFieldsRef.current = extraFields;
  }, [extraFields]);
  useEffect(() => {
    skipConditionRef.current = skipCondition;
  }, [skipCondition]);

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
    if (skipConditionRef.current?.()) {
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
      const extras = extraFieldsRef.current?.() ?? {};

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
        ...extras,
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
