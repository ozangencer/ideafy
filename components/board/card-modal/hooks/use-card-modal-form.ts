"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AiPlatform, Card, Complexity, Priority, Project, Status } from "@/lib/types";
import type { CardUpdatePayload } from "@/lib/kanban-store/types";

interface UseCardModalFormOptions {
  selectedCard: Card | null;
  isDraftMode: boolean;
  projects: Project[];
  saveDraftCard: (
    cardData: Omit<Card, "id" | "createdAt" | "updatedAt" | "taskNumber" | "completedAt">
  ) => Promise<void>;
  updateCard: (id: string, updates: CardUpdatePayload) => Promise<void>;
  discardDraft: () => void;
  closeModal: () => void;
  detachConversation: () => void;
  /**
   * Called after a non-draft save has dispatched `updateCard(...)`.
   * Consumers (e.g. cloud wrapper) use this for side-effects like
   * assignment notifications. Invoked with the saved id and payload.
   */
  afterSave?: (savedCardId: string, updates: Partial<Card>) => void;
}

export function useCardModalForm(options: UseCardModalFormOptions) {
  const {
    selectedCard,
    isDraftMode,
    projects,
    saveDraftCard,
    updateCard,
    discardDraft,
    closeModal,
    detachConversation,
    afterSave,
  } = options;

  // Latest-value ref so afterSave additions don't churn handleSave's deps
  const afterSaveRef = useRef(afterSave);
  useEffect(() => {
    afterSaveRef.current = afterSave;
  }, [afterSave]);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [solutionSummary, setSolutionSummary] = useState("");
  const [testScenarios, setTestScenarios] = useState("");
  const [aiOpinion, setAiOpinion] = useState("");
  const [status, setStatus] = useState<Status>("ideation");
  const [complexity, setComplexity] = useState<Complexity>("medium");
  const [priority, setPriority] = useState<Priority>("medium");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [aiPlatform, setAiPlatform] = useState<AiPlatform | null>(null);

  // Close-flow UI state
  const [isVisible, setIsVisible] = useState(false);
  const [cardHistory, setCardHistory] = useState<string[]>([]);
  const [showDiscardDraftDialog, setShowDiscardDraftDialog] = useState(false);

  // Derived values
  const hasUnsavedChanges = !!selectedCard && (
    title !== selectedCard.title ||
    description !== selectedCard.description ||
    solutionSummary !== selectedCard.solutionSummary ||
    testScenarios !== selectedCard.testScenarios ||
    aiOpinion !== selectedCard.aiOpinion ||
    status !== selectedCard.status ||
    complexity !== (selectedCard.complexity || "medium") ||
    priority !== (selectedCard.priority || "medium") ||
    projectId !== selectedCard.projectId ||
    aiPlatform !== (selectedCard.aiPlatform ?? null)
  );

  const hasDraftChanges = isDraftMode && (
    title.trim() !== "" ||
    description.trim() !== "" ||
    solutionSummary.trim() !== "" ||
    testScenarios.trim() !== "" ||
    aiOpinion.trim() !== ""
  );

  const isTitleValid = (title || "").trim().length > 0;
  const canSave = projectId !== null && isTitleValid;

  // Slide-in animation on card open
  useEffect(() => {
    if (selectedCard) {
      requestAnimationFrame(() => setIsVisible(true));
    } else {
      setIsVisible(false);
    }
  }, [selectedCard]);

  // Stable applier used by useCardModalFormReset
  const applyCardToForm = useCallback((card: Card) => {
    setTitle(card.title);
    setDescription(card.description);
    setSolutionSummary(card.solutionSummary);
    setTestScenarios(card.testScenarios);
    setAiOpinion(card.aiOpinion);
    setStatus(card.status);
    setComplexity(card.complexity || "medium");
    setPriority(card.priority || "medium");
    setProjectId(card.projectId);
    setAiPlatform(card.aiPlatform ?? null);
  }, []);

  const handleClose = useCallback(() => {
    if (showDiscardDraftDialog) return;
    if (isDraftMode && hasDraftChanges) {
      setShowDiscardDraftDialog(true);
      return;
    }
    setCardHistory([]);
    setIsVisible(false);
    // Detach from conversation stream - process continues in background
    detachConversation();
    if (isDraftMode) {
      setTimeout(() => discardDraft(), 200);
    } else {
      setTimeout(() => closeModal(), 200);
    }
  }, [isDraftMode, hasDraftChanges, showDiscardDraftDialog, discardDraft, closeModal, detachConversation]);

  const handleForceClose = useCallback(() => {
    setShowDiscardDraftDialog(false);
    setCardHistory([]);
    setIsVisible(false);
    detachConversation();
    setTimeout(() => discardDraft(), 200);
  }, [discardDraft, detachConversation]);

  const handleSave = useCallback(() => {
    if (!selectedCard) return;

    const selectedProject = projects.find((p) => p.id === projectId);

    if (isDraftMode) {
      saveDraftCard({
        title,
        description,
        solutionSummary,
        testScenarios,
        aiOpinion,
        aiVerdict: null,
        status,
        complexity,
        priority,
        projectId,
        aiPlatform,
        projectFolder: selectedProject?.folderPath || "",
        gitBranchName: null,
        gitBranchStatus: null,
        gitWorktreePath: null,
        gitWorktreeStatus: null,
        devServerPort: null,
        devServerPid: null,
        rebaseConflict: null,
        conflictFiles: null,
        processingType: null,
        useWorktree: null,
      });
    } else {
      const cardId = selectedCard.id;
      const updates = {
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
        baseUpdatedAt: selectedCard.updatedAt,
      };
      handleClose();
      updateCard(cardId, updates);
      afterSaveRef.current?.(cardId, updates);
    }
  }, [
    selectedCard,
    projects,
    projectId,
    isDraftMode,
    title,
    description,
    solutionSummary,
    testScenarios,
    aiOpinion,
    status,
    complexity,
    priority,
    aiPlatform,
    saveDraftCard,
    updateCard,
    handleClose,
  ]);

  return {
    // form fields
    title,
    setTitle,
    description,
    setDescription,
    solutionSummary,
    setSolutionSummary,
    testScenarios,
    setTestScenarios,
    aiOpinion,
    setAiOpinion,
    status,
    setStatus,
    complexity,
    setComplexity,
    priority,
    setPriority,
    projectId,
    setProjectId,
    aiPlatform,
    setAiPlatform,
    // close-flow ui state
    isVisible,
    setIsVisible,
    cardHistory,
    setCardHistory,
    showDiscardDraftDialog,
    setShowDiscardDraftDialog,
    // derived
    isTitleValid,
    canSave,
    hasUnsavedChanges,
    hasDraftChanges,
    // handlers
    handleSave,
    handleClose,
    handleForceClose,
    // reset helper
    applyCardToForm,
  };
}
