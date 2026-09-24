"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { AiPlatform, Card, Complexity, Priority, Project, Status } from "@/lib/types";
import type { CardUpdatePayload } from "@/lib/kanban-store/types";

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
  groupId: string | null;
  aiPlatform: AiPlatform | null;
  projects: Project[];
  updateCard: (id: string, updates: CardUpdatePayload) => Promise<boolean | void>;
  /**
   * Ref holding the `updatedAt` of the card state currently reflected in
   * the form. Use this (not the live selectedCard.updatedAt) as
   * `baseUpdatedAt` so external writes under an unsynced modal still look
   * stale to the server.
   */
  formBaseUpdatedAtRef: MutableRefObject<string | null>;
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
    groupId,
    aiPlatform,
    projects,
    updateCard,
    formBaseUpdatedAtRef,
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

  // The save payload as of the latest render. The debounced save and
  // flushPendingAutoSave both read it, so a flush sends exactly what the
  // timer would have.
  const buildPayload = (): CardUpdatePayload | null => {
    if (!selectedCard) return null;
    const selectedProject = projects.find((p) => p.id === projectId);
    const extras = extraFieldsRef.current?.() ?? {};
    return {
      title,
      description,
      solutionSummary,
      testScenarios,
      aiOpinion,
      status,
      complexity,
      priority,
      projectId,
      groupId,
      aiPlatform,
      projectFolder: selectedProject?.folderPath || selectedCard.projectFolder,
      baseUpdatedAt: formBaseUpdatedAtRef.current ?? selectedCard.updatedAt,
      ...extras,
    };
  };
  const buildPayloadRef = useRef(buildPayload);
  buildPayloadRef.current = buildPayload;
  const flushStateRef = useRef({ selectedCard, isDraftMode, canSave, hasUnsavedChanges });
  flushStateRef.current = { selectedCard, isDraftMode, canSave, hasUnsavedChanges };

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

      const payload = buildPayloadRef.current();
      if (!payload) return;

      setSaveStatus("saving");

      autoSaveInFlightRef.current = true;
      updateCard(selectedCard.id, payload).finally(() => {
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
    groupId,
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

  /**
   * Write the pending edit now instead of in up to 500ms. Actions that hand
   * the card to an agent call this first — otherwise a plan edited a moment
   * ago is still in the form when the server reads the card from disk, and
   * the agent silently works from the old one. Resolves false when there was
   * something to save and it did not land.
   */
  const flushPendingAutoSave = useCallback(async (): Promise<boolean> => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    const state = flushStateRef.current;
    if (!state.selectedCard || state.isDraftMode || !state.hasUnsavedChanges) return true;
    if (skipConditionRef.current?.()) return true;
    if (!state.canSave) return false;

    const payload = buildPayloadRef.current();
    if (!payload) return true;

    setSaveStatus("saving");
    autoSaveInFlightRef.current = true;
    let ok = true;
    try {
      ok = (await updateCard(state.selectedCard.id, payload)) !== false;
    } finally {
      setTimeout(() => {
        autoSaveInFlightRef.current = false;
      }, 200);
    }

    setSaveStatus(ok ? "saved" : "idle");
    if (ok) {
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
      savedTimeoutRef.current = setTimeout(() => {
        setSaveStatus("idle");
      }, 2000);
    }
    return ok;
  }, [updateCard]);

  const markExternalUpdate = useCallback(() => {
    lastMcpUpdateRef.current = Date.now();
  }, []);

  return {
    saveStatus,
    cancelPendingAutoSave,
    flushPendingAutoSave,
    markExternalUpdate,
    autoSaveInFlightRef,
  };
}
