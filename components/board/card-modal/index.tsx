"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useKanbanStore } from "@/lib/store";
import {
  type Card,
  getDisplayId,
  GitBranchStatus,
  GitWorktreeStatus,
  SectionType,
  MentionData,
  type MergeReality,
  RUN_MODE_LABELS,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  GitBranch,
  GitMerge,
  Undo2,
  Loader2,
  FolderGit2,
  MonitorPlay,
  MonitorStop,
  ExternalLink,
  AlertTriangle,
  Terminal,
  Check,
  X,
  ChevronRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { downloadCardAsMarkdown } from "@/lib/card-export";

// New modular components
import { CardModalHeader } from "./card-modal-header";
import { CardSessionsPopover } from "./sections/card-sessions-popover";
import { CardModalTabs } from "./card-modal-tabs";
import { CardModalFooter } from "./card-modal-footer";
import { SplitPanel } from "./split-panel";
import { SectionEditor } from "./sections/section-editor";
import { ConversationPanel } from "./sections/conversation-panel";
import { CardPhaseActions, type PhaseHandOff } from "../card-phase-actions";
import { isAutonomousAction } from "@/lib/card-phase";

// Hooks
import { useCardModalForm } from "./hooks/use-card-modal-form";
import { useCardModalAutoSave } from "./hooks/use-card-modal-auto-save";
import { useCardModalFormReset } from "./hooks/use-card-modal-form-reset";
import { CardModalContext, type CardModalContextValue } from "./card-modal-context";

export interface CardModalProps {
  /** Replaces the default header entirely. Slot consumer pulls state via `useCardModalContext()`. */
  headerSlot?: ReactNode;
  /** Replaces the default footer entirely. Slot consumer pulls state via `useCardModalContext()`. */
  footerSlot?: ReactNode;
  /** When true, default header/editor enter read-only mode and auto-save is suppressed. */
  readOnly?: boolean;
  /** Extra fields merged into the auto-save payload. Forwarded to `useCardModalAutoSave`. */
  extraFields?: () => Record<string, unknown>;
  /**
   * Overrides the auto-save skip check. Evaluated when the effect runs. If omitted,
   * `readOnly` drives the skip: readOnly true → auto-save suppressed.
   */
  skipCondition?: () => boolean;
  /** Invoked after a non-draft save has dispatched. Forwarded to `useCardModalForm`. */
  afterSave?: (savedCardId: string, updates: Partial<Card>) => void;
}

export function CardModal({
  headerSlot,
  footerSlot,
  readOnly = false,
  extraFields,
  skipCondition,
  afterSave,
}: CardModalProps = {}) {
  const {
    selectedCard,
    closeModal,
    updateCard,
    deleteCard,
    moveCard,
    projects,
    cards,
    selectCard,
    openModal,
    draftCard,
    saveDraftCard,
    discardDraft,
    startDevServer,
    stopDevServer,
    // Conversation state and actions
    conversations,
    streamingMessage,
    isConversationLoading,
    fetchConversation,
    sendMessage,
    cancelConversation,
    detachConversation,
    attachLiveStream,
    clearConversation,
    // Background processes
    backgroundProcesses,
    fetchBackgroundProcesses,
    lockedCardIds,
    // Activity bell deep-link
    pendingCardSection,
    setPendingCardSection,
    markActivityReadForCard,
  } = useKanbanStore();
  const { toast } = useToast();

  // Check if we're in draft mode (creating a new card)
  const isDraftMode = selectedCard?.id?.startsWith("draft-") ?? false;

  // Form + close-flow
  const form = useCardModalForm({
    selectedCard,
    isDraftMode,
    projects,
    saveDraftCard,
    updateCard,
    discardDraft,
    closeModal,
    detachConversation,
    afterSave,
  });

  const {
    title, setTitle,
    description, setDescription,
    solutionSummary, setSolutionSummary,
    testScenarios, setTestScenarios,
    aiOpinion, setAiOpinion,
    status, setStatus,
    complexity, setComplexity,
    priority, setPriority,
    projectId, setProjectId,
    groupId, setGroupId,
    aiPlatform, setAiPlatform,
    isVisible,
    cardHistory, setCardHistory,
    showDiscardDraftDialog, setShowDiscardDraftDialog,
    isTitleValid,
    canSave,
    hasUnsavedChanges,
    handleSave,
    handleClose,
    handleForceClose,
    applyCardToForm,
    formBaseUpdatedAtRef,
  } = form;

  // UI state not owned by the form hook
  // Default to expanded; remember the user's last choice so reopening matches
  // the previous session. Reads localStorage lazily to avoid SSR mismatch.
  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem("cardModal:isExpanded");
    return stored === null ? true : stored === "true";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("cardModal:isExpanded", String(isExpanded));
  }, [isExpanded]);
  const [activeTab, setActiveTab] = useState<SectionType>("detail");

  // Back navigation parks the tab to restore here; the form-reset hook
  // applies it in place of the column's tab when the card switches.
  const tabOverrideRef = useRef<SectionType | null>(null);

  // Opening a card — from the board, search, the bell or a shortcut — counts
  // as reading its activity, so the bell's row dots don't outlive the result.
  const selectedCardId = selectedCard?.id;
  useEffect(() => {
    if (!selectedCardId || isDraftMode) return;
    markActivityReadForCard(selectedCardId);
  }, [selectedCardId, isDraftMode, markActivityReadForCard]);

  // Git state
  const [gitBranchName, setGitBranchName] = useState<string | null>(null);
  const [gitBranchStatus, setGitBranchStatus] = useState<GitBranchStatus>(null);
  const [gitWorktreePath, setGitWorktreePath] = useState<string | null>(null);
  const [gitWorktreeStatus, setGitWorktreeStatus] = useState<GitWorktreeStatus>(null);
  const [isMerging, setIsMerging] = useState(false);
  // What git actually contains, as opposed to what gitBranchStatus remembers.
  // null while unknown (not fetched yet, or the check failed) — the UI falls
  // back to the plain merge button in that case.
  const [mergeReality, setMergeReality] = useState<MergeReality | null>(null);
  const [isCheckingMergeReality, setIsCheckingMergeReality] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [showRollbackDialog, setShowRollbackDialog] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [showCommitFirstDialog, setShowCommitFirstDialog] = useState(false);
  const [commitFirstScope, setCommitFirstScope] = useState<"main" | "worktree">("main");
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [showMergeConfirmDialog, setShowMergeConfirmDialog] = useState(false);
  const [conflictInfo, setConflictInfo] = useState<{
    conflictFiles: string[];
    worktreePath: string;
    branchName: string;
    displayId: string;
  } | null>(null);

  // Dev server state
  const [devServerPort, setDevServerPort] = useState<number | null>(null);
  const [devServerPid, setDevServerPid] = useState<number | null>(null);
  const [isServerLoading, setIsServerLoading] = useState(false);
  const [showGitDetails, setShowGitDetails] = useState(false);

  const overlayMouseDownRef = useRef(false);

  // Get project and displayId
  const project = projects.find((p) => p.id === projectId);
  const isWorkProject = project?.mode === "work";
  const displayId = selectedCard ? getDisplayId(selectedCard, project) : null;

  // What the run button means here. Cards without a project keep the historical
  // dev-server shape rather than losing the button entirely.
  const runMode = project?.resolvedRunMode ?? "server";
  const runLabels = RUN_MODE_LABELS[runMode];
  // Opening Xcode hands off and returns — there is no process to stop.
  const isOneShotRun = runMode === "xcode";
  const runIsActive = !isOneShotRun && !!devServerPid;

  // The card as the store has it. startTask and openTerminal write their
  // results to `cards`; selectedCard only catches up on the next poll, so the
  // lock and spinner are read from here.
  const liveCard = selectedCard
    ? cards.find((c) => c.id === selectedCard.id) ?? selectedCard
    : null;

  // A run or a terminal session owns the card. Starting one from here closes
  // the modal (handleHandOff); this lock covers the card reopened from the
  // board while the run is still going. It turns the form read-only, so
  // nothing typed here can race the agent's own writes to the same fields.
  const isRunLocked =
    !!selectedCard &&
    !isDraftMode &&
    (lockedCardIds.includes(selectedCard.id) ||
      !!liveCard?.processingType ||
      backgroundProcesses.some(
        (p) => p.cardId === selectedCard.id && p.processType !== "chat" && p.status === "running"
      ));
  const effectiveReadOnly = readOnly || isRunLocked;
  const isRunLockedRef = useRef(isRunLocked);
  isRunLockedRef.current = isRunLocked;

  // Auto-save. skipCondition falls back to `readOnly` when the caller didn't
  // provide one; a run lock suppresses it either way.
  const effectiveSkipCondition = useCallback(
    () => isRunLockedRef.current || (skipCondition ? skipCondition() : readOnly),
    [skipCondition, readOnly]
  );
  const { saveStatus, cancelPendingAutoSave, flushPendingAutoSave, markExternalUpdate, autoSaveInFlightRef } = useCardModalAutoSave({
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
    skipCondition: effectiveSkipCondition,
  });

  // Git/dev-server setters bundled for the form-reset hook
  const applyCardToGit = useCallback((card: Card) => {
    setGitBranchName(card.gitBranchName);
    setGitBranchStatus(card.gitBranchStatus);
    setGitWorktreePath(card.gitWorktreePath);
    setGitWorktreeStatus(card.gitWorktreeStatus);
    setDevServerPort(card.devServerPort);
    setDevServerPid(card.devServerPid);
  }, []);

  // Form resync when selectedCard changes (respects auto-save in-flight guard)
  useCardModalFormReset({
    selectedCard,
    isDraftMode,
    activeTab,
    setActiveTab,
    fetchConversation,
    autoSaveInFlightRef,
    hasUnsavedChanges,
    cancelPendingAutoSave,
    markExternalUpdate,
    applyCardToForm,
    applyCardToGit,
    tabOverrideRef,
  });

  // Honor the deep-link target set by the activity bell. Apply once per
  // selectedCard transition and clear so subsequent opens fall back to the
  // column's tab. Must stay below useCardModalFormReset: effects run in
  // declaration order, so this setActiveTab lands last and beats the rule.
  useEffect(() => {
    if (selectedCard && pendingCardSection) {
      setActiveTab(pendingCardSection);
      setPendingCardSection(null);
    }
  }, [selectedCard, pendingCardSection, setPendingCardSection]);

  // When a run ends, take what it wrote. startTask finishes by putting the new
  // plan or checklist into `cards` and releasing the lock in the same update;
  // waiting for the poll to refresh selectedCard would leave an editable form
  // showing the old content for up to ten seconds — and an edit made then
  // would be saved over the run's result.
  const wasRunLockedRef = useRef(false);
  useEffect(() => {
    const wasLocked = wasRunLockedRef.current;
    wasRunLockedRef.current = isRunLocked;
    if (!wasLocked || isRunLocked || !selectedCard) return;
    const fresh = useKanbanStore.getState().cards.find((c) => c.id === selectedCard.id);
    if (fresh && fresh.updatedAt !== selectedCard.updatedAt) selectCard(fresh);
  }, [isRunLocked, selectedCard, selectCard]);

  // Save what is in the form before an action hands the card to an agent,
  // which reads it from disk. If the save fails the action does not start —
  // running the previous plan without a word is the failure this prevents.
  const handleBeforeRun = useCallback(async () => {
    const ok = await flushPendingAutoSave();
    if (!ok) {
      toast({
        variant: "destructive",
        title: "Couldn't save your edits",
        description: isTitleValid
          ? "Nothing was started, so the agent won't work from an outdated card. Try again."
          : "Add a title first. Nothing was started.",
      });
      return false;
    }
    // Line the form and selectedCard up with what was just saved. Otherwise
    // the form still differs from the pre-save selectedCard, reads as an
    // unsaved edit, and the resync guard keeps the run's writes out of it.
    if (selectedCard) {
      const saved = useKanbanStore.getState().cards.find((c) => c.id === selectedCard.id);
      if (saved && saved.updatedAt !== selectedCard.updatedAt) {
        applyCardToForm(saved);
        selectCard(saved);
      }
    }
    return true;
  }, [flushPendingAutoSave, toast, isTitleValid, selectedCard, applyCardToForm, selectCard]);

  // An action that sends the card elsewhere takes the modal with it: the board
  // is where the column moves and the spinner turns. A background run's
  // request only returns when the run ends, so the modal closes on the click
  // and a failure arrives as a toast later. A terminal answers within a
  // second, so the modal waits and stays open if it didn't open.
  const handleHandOff = useCallback(
    ({ action, label, run }: PhaseHandOff) => {
      const cardId = selectedCard?.id;
      const reportFailure = (error?: string) => {
        // A 409 for untrusted content is a question, not a failure: the
        // app-level dialog is already asking it.
        if (useKanbanStore.getState().pendingRunConfirmation?.cardId === cardId) return;
        toast({
          variant: "destructive",
          title: `${label} failed`,
          description: error || "Nothing was changed on the card.",
        });
      };

      if (isAutonomousAction(action)) {
        handleClose();
        toast({
          title: `${label} started`,
          description: "You'll get a notice when it finishes.",
        });
        void run.then((result) => {
          if (!result.success) reportFailure(result.error);
        });
        return;
      }

      void run.then((result) => {
        if (result.success) handleClose();
        else reportFailure(result.error);
      });
    },
    [selectedCard, handleClose, toast]
  );

  // Section content mapping
  const sectionValues: Record<SectionType, string> = {
    detail: description,
    opinion: aiOpinion,
    solution: solutionSummary,
    tests: testScenarios,
  };

  const sectionSetters: Record<SectionType, (value: string) => void> = {
    detail: setDescription,
    opinion: setAiOpinion,
    solution: setSolutionSummary,
    tests: setTestScenarios,
  };

  // Fetch conversation when tab changes
  useEffect(() => {
    if (selectedCard && !isDraftMode) {
      fetchConversation(selectedCard.id, activeTab);
    }
  }, [activeTab, selectedCard, isDraftMode, fetchConversation]);

  // Poll background processes to detect running chat streams
  useEffect(() => {
    if (!selectedCard || isDraftMode) return;
    fetchBackgroundProcesses();
  }, [selectedCard, isDraftMode, fetchBackgroundProcesses]);

  // Get current conversation messages
  const conversationKey = selectedCard ? `${selectedCard.id}-${activeTab}` : "";
  const currentMessages = conversations[conversationKey] || [];

  // Check if there's a background process running for this card+section
  const isBackgroundProcessing = useMemo(() => {
    if (!selectedCard) return false;
    const processKey = `${selectedCard.id}-${activeTab}`;
    return backgroundProcesses.some(
      (p) => p.id === processKey && p.status === "running"
    );
  }, [selectedCard, activeTab, backgroundProcesses]);

  // Reattach to a still-running stream when this card+section was active
  // before the modal was closed (or HMR reset the in-flight fetch). Server
  // keeps the CLI alive and mirrors events into a buffer the live endpoint
  // replays + tails.
  useEffect(() => {
    if (!selectedCard || isDraftMode) return;
    if (!isBackgroundProcessing) return;
    const isAlreadyAttached =
      streamingMessage?.cardId === selectedCard.id &&
      streamingMessage?.sectionType === activeTab;
    if (isAlreadyAttached) return;
    void attachLiveStream(selectedCard.id, activeTab);
  }, [selectedCard, activeTab, isDraftMode, isBackgroundProcessing, streamingMessage, attachLiveStream]);

  // Handle card mention click
  const handleCardClick = useCallback((cardId: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (card && card.id !== selectedCard?.id) {
      if (selectedCard) {
        setCardHistory((prev) => [...prev, { cardId: selectedCard.id, activeTab }]);
      }
      selectCard(card);
      openModal();
    }
  }, [cards, selectedCard, activeTab, selectCard, openModal, setCardHistory]);

  // Handle back navigation — restore the tab the user was on when they
  // clicked through, not whatever tab the destination card auto-opened to.
  const handleBack = useCallback(() => {
    if (cardHistory.length > 0) {
      const newHistory = [...cardHistory];
      const previousEntry = newHistory.pop();
      setCardHistory(newHistory);

      if (previousEntry) {
        const previousCard = cards.find((c) => c.id === previousEntry.cardId);
        if (previousCard) {
          tabOverrideRef.current = previousEntry.activeTab;
          selectCard(previousCard);
        }
      }
    }
  }, [cardHistory, cards, selectCard, setCardHistory]);

  // Handle export
  const handleExport = useCallback(() => {
    if (selectedCard) {
      downloadCardAsMarkdown(selectedCard, project);
    }
  }, [selectedCard, project]);

  // Handle delete
  const handleDelete = useCallback(() => {
    if (selectedCard) {
      deleteCard(selectedCard.id);
    }
  }, [selectedCard, deleteCard]);

  // Handle withdraw
  // Goes through moveCard rather than updateCard so the withdraw lands on the
  // undo stack like any other column change.
  const handleWithdraw = useCallback(() => {
    if (selectedCard) {
      moveCard(selectedCard.id, "withdrawn");
      handleClose();
    }
  }, [selectedCard, moveCard, handleClose]);

  // Handle send message in chat
  const handleSendMessage = useCallback((content: string, mentions: MentionData[]) => {
    if (!selectedCard || isDraftMode) return;

    sendMessage(
      selectedCard.id,
      activeTab,
      content,
      mentions,
      project?.folderPath || "",
      sectionValues[activeTab]
    );
  }, [selectedCard, isDraftMode, activeTab, project, sectionValues, sendMessage]);

  // Handle clear conversation
  const handleClearConversation = useCallback(() => {
    if (!selectedCard || isDraftMode) return;
    clearConversation(selectedCard.id, activeTab);
  }, [selectedCard, isDraftMode, activeTab, clearConversation]);

  // Ask git whether this branch still has anything to merge. gitBranchStatus
  // only leaves "active" when Ideafy itself merges, so a branch merged in a
  // terminal would otherwise keep offering "Merge & Complete" over nothing.
  const cardId = selectedCard?.id ?? null;
  const shouldCheckMergeReality =
    !isDraftMode &&
    !!cardId &&
    status === "test" &&
    !!gitBranchName &&
    gitBranchStatus === "active";

  useEffect(() => {
    if (!shouldCheckMergeReality || !cardId) {
      setMergeReality(null);
      return;
    }

    let cancelled = false;
    setIsCheckingMergeReality(true);

    fetch(`/api/cards/${cardId}/git/status`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: MergeReality | { error: string } | null) => {
        if (cancelled) return;
        // Fail open: an unreadable repo leaves the plain merge button in place
        // rather than blocking a merge that might well succeed.
        setMergeReality(data && !("error" in data) ? data : null);
      })
      .catch(() => {
        if (!cancelled) setMergeReality(null);
      })
      .finally(() => {
        if (!cancelled) setIsCheckingMergeReality(false);
      });

    return () => {
      cancelled = true;
    };
  }, [shouldCheckMergeReality, cardId]);

  // A Human Test card with no branch may simply have lost track of it: a run
  // that died before recording its worktree, with the work carried on by chat
  // or terminal. Ask the server to reclaim it before settling on the
  // branchless panel, so real commits get a Merge & Complete (IDE-343).
  const shouldTryLinkBranch =
    !isDraftMode && !!cardId && status === "test" && !gitBranchName;
  const [isLinkingBranch, setIsLinkingBranch] = useState(false);

  useEffect(() => {
    if (!shouldTryLinkBranch || !cardId) {
      setIsLinkingBranch(false);
      return;
    }

    let cancelled = false;
    setIsLinkingBranch(true);

    fetch(`/api/cards/${cardId}/git/link`, { method: "POST" })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          data: {
            linked: boolean;
            gitBranchName?: string;
            gitBranchStatus?: GitBranchStatus;
            gitWorktreePath?: string | null;
            gitWorktreeStatus?: GitWorktreeStatus;
          } | null
        ) => {
          if (cancelled || !data?.linked || !data.gitBranchName) return;
          const fields = {
            gitBranchName: data.gitBranchName,
            gitBranchStatus: data.gitBranchStatus ?? "active",
            gitWorktreePath: data.gitWorktreePath ?? null,
            gitWorktreeStatus: data.gitWorktreeStatus ?? null,
          };
          setGitBranchName(fields.gitBranchName);
          setGitBranchStatus(fields.gitBranchStatus);
          setGitWorktreePath(fields.gitWorktreePath);
          setGitWorktreeStatus(fields.gitWorktreeStatus);
          // Patch the store's copies too, or the next resync would put the
          // stale branchless card back into the modal. The form-reset hook
          // still skips its resync while the user has unsaved edits.
          const patch = (c: Card) => (c.id === cardId ? { ...c, ...fields } : c);
          const { cards, selectedCard: current } = useKanbanStore.getState();
          useKanbanStore.setState({
            cards: cards.map(patch),
            selectedCard: current ? patch(current) : current,
          });
        }
      )
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLinkingBranch(false);
      });

    return () => {
      cancelled = true;
    };
  }, [shouldTryLinkBranch, cardId]);

  // Nothing left to merge — close the card out without pretending a merge ran.
  const handleCompleteWithoutMerge = async () => {
    if (!selectedCard || isCompleting) return;

    setIsCompleting(true);
    try {
      const response = await fetch(`/api/cards/${selectedCard.id}/git/complete`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        // The server recomputes the verdict; if it disagreed, take its answer
        // so the button stops offering something that no longer applies.
        if (data?.reality) setMergeReality(data.reality);
        toast({
          variant: "destructive",
          title: "Complete Failed",
          description: data?.error || "An error occurred while completing the card",
        });
        return;
      }

      await useKanbanStore.getState().fetchCards();
      toast({
        title: "Card Completed",
        description: data?.message || "Branch was already merged, card moved to Completed",
      });
      handleClose();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Complete Failed",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsCompleting(false);
    }
  };

  /**
   * Finish a Human Test card that never got a branch of its own.
   *
   * Work that did not run through Ideafy leaves nothing to merge or delete, so
   * the git panel stays hidden — but the tester still has a verdict to record,
   * and without this the only way to act on it is the Status dropdown.
   */
  const handleFinishWithoutBranch = async (outcome: "completed" | "bugs") => {
    if (!selectedCard || isCompleting) return;

    setIsCompleting(true);
    try {
      // Keep the form in step with the write so a pending auto-save agrees
      // with it rather than putting the card back in Human Test.
      setStatus(outcome);
      await updateCard(selectedCard.id, { status: outcome });
      toast({
        title: outcome === "completed" ? "Card Completed" : "Sent back to Bugs",
        description:
          outcome === "completed"
            ? "Moved to Completed."
            : "Moved to Bugs to be worked on again.",
      });
      handleClose();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Couldn't move the card",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsCompleting(false);
    }
  };

  // Git operations (same as before)
  const handleMerge = async (commitFirst = false) => {
    if (!selectedCard) return;

    setIsMerging(true);
    try {
      const response = await fetch(`/api/cards/${selectedCard.id}/git/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commitFirst }),
      });

      if (!response.ok) {
        const error = await response.json();

        if (error.rebaseConflict) {
          setConflictInfo({
            conflictFiles: error.conflictFiles || [],
            worktreePath: error.worktreePath || "",
            branchName: error.branchName || "",
            displayId: error.displayId || "",
          });
          setShowConflictDialog(true);
          await useKanbanStore.getState().fetchCards();
          if (error.stashRestoreWarning) {
            toast({
              variant: "destructive",
              title: "Stash Restore Warning",
              description: error.stashRestoreWarning,
            });
          }
          return;
        }

        if (error.uncommittedInWorktree) {
          setCommitFirstScope("worktree");
          setShowCommitFirstDialog(true);
          return;
        }

        toast({
          variant: "destructive",
          title: "Merge Failed",
          description: error.error || "An error occurred during merge",
        });
        if (error.stashRestoreWarning) {
          toast({
            variant: "destructive",
            title: "Stash Restore Warning",
            description: error.stashRestoreWarning,
          });
        }
        return;
      }

      const data = await response.json().catch(() => ({}));
      await useKanbanStore.getState().fetchCards();
      if (data?.stashRestoreWarning) {
        toast({
          variant: "destructive",
          title: "Branch Merged — Stash Restore Warning",
          description: data.stashRestoreWarning,
        });
      } else {
        toast({
          title: "Branch Merged",
          description: "Successfully merged and moved to Completed",
        });
      }
      handleClose();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Merge Failed",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsMerging(false);
    }
  };

  const handleCommitAndMerge = async () => {
    setShowCommitFirstDialog(false);
    await handleMerge(true);
  };

  const handleSolveConflictWithAI = async () => {
    if (!selectedCard || !conflictInfo) return;

    setShowConflictDialog(false);
    try {
      const response = await fetch(`/api/cards/${selectedCard.id}/resolve-conflict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conflictFiles: conflictInfo.conflictFiles,
          worktreePath: conflictInfo.worktreePath,
          branchName: conflictInfo.branchName,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast({
          variant: "destructive",
          title: "Failed to Open Terminal",
          description: data.error || "Could not open terminal for conflict resolution",
        });
        return;
      }

      toast({
        title: "Terminal Opened",
        description: "Claude Code is ready to help resolve the conflict",
      });
      handleClose();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to open terminal",
      });
    }
  };

  const handleStartDevServer = async () => {
    if (!selectedCard || isServerLoading) return;

    setIsServerLoading(true);
    try {
      const result = await startDevServer(selectedCard.id);
      if (!result.success) {
        toast({
          variant: "destructive",
          title: `Failed to ${runLabels.start}`,
          description: result.error || "Unknown error",
        });
        return;
      }

      // Handing off to Xcode leaves no process to track — report and stop.
      if (result.oneShot) {
        toast({
          title: runLabels.start,
          description: result.message || "Done",
        });
        return;
      }

      setDevServerPort(result.port ?? null);
      const updatedCard = useKanbanStore.getState().cards.find((c) => c.id === selectedCard.id);
      if (updatedCard) {
        setDevServerPid(updatedCard.devServerPid);
      }
      toast({
        title: "Started",
        description: result.port ? `Running on port ${result.port}` : "Running",
      });
    } finally {
      setIsServerLoading(false);
    }
  };

  const handleStopDevServer = async () => {
    if (!selectedCard || isServerLoading) return;

    setIsServerLoading(true);
    try {
      const result = await stopDevServer(selectedCard.id);
      if (result.success) {
        setDevServerPort(null);
        setDevServerPid(null);
        toast({
          title: "Dev Server Stopped",
        });
      } else {
        toast({
          variant: "destructive",
          title: "Failed to Stop Server",
          description: result.error || "Unknown error",
        });
      }
    } finally {
      setIsServerLoading(false);
    }
  };

  const handleRollback = async (deleteBranch: boolean) => {
    if (!selectedCard) return;

    setIsRollingBack(true);
    try {
      const response = await fetch(`/api/cards/${selectedCard.id}/git/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteBranch }),
      });

      if (!response.ok) {
        const error = await response.json();
        toast({
          variant: "destructive",
          title: "Couldn't send the card back",
          description: error.error || "An error occurred during rollback",
        });
        return;
      }

      await useKanbanStore.getState().fetchCards();
      setShowRollbackDialog(false);
      toast({
        title: "Sent back to Bugs",
        // The old copy said "Switched to main", which never happened.
        description: deleteBranch
          ? "The code from this attempt was deleted."
          : "The code from this attempt was kept.",
      });
      handleClose();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Couldn't send the card back",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsRollingBack(false);
    }
  };

  // ESC key handler
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [handleClose]);

  // Lock body scroll when modal is open (prevents iOS background scroll)
  useEffect(() => {
    if (!selectedCard) return;
    const scrollY = window.scrollY;
    document.body.classList.add("modal-open");
    document.body.style.top = `-${scrollY}px`;
    return () => {
      document.body.classList.remove("modal-open");
      document.body.style.top = "";
      window.scrollTo(0, scrollY);
    };
  }, [selectedCard]);

  if (!selectedCard) return null;

  // Phase actions read the form, not the saved card: a plan pasted a moment
  // ago should already turn "Plan Task" into "Implement". The flush in
  // handleBeforeRun makes the saved card match before anything runs.
  const phaseActions =
    !isDraftMode && !readOnly && liveCard && status !== "withdrawn" ? (
      <CardPhaseActions
        card={{
          ...liveCard,
          description,
          solutionSummary,
          testScenarios,
          aiOpinion,
          status,
          projectId,
        }}
        variant="labeled"
        beforeRun={handleBeforeRun}
        onHandOff={handleHandOff}
      />
    ) : null;

  const contextValue: CardModalContextValue = {
    selectedCard,
    projects,
    project,
    displayId,
    isDraftMode,
    title, setTitle,
    description, setDescription,
    solutionSummary, setSolutionSummary,
    testScenarios, setTestScenarios,
    aiOpinion, setAiOpinion,
    status, setStatus,
    complexity, setComplexity,
    priority, setPriority,
    projectId, setProjectId,
    groupId, setGroupId,
    aiPlatform, setAiPlatform,
    isTitleValid,
    canSave,
    cardHistory,
    isExpanded,
    setIsExpanded,
    readOnly: effectiveReadOnly,
    isRunLocked,
    phaseActions,
    saveStatus,
    handleBack,
    handleExport,
    handleClose,
    handleDelete,
    handleWithdraw,
    handleSave,
  };

  return (
    <CardModalContext.Provider value={contextValue}>
    <div
      className={`fixed inset-0 z-50 flex justify-end transition-colors duration-200 overscroll-none ${
        isVisible ? "bg-black/40" : "bg-transparent"
      }`}
      onMouseDown={(e) => {
        overlayMouseDownRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && overlayMouseDownRef.current) {
          handleClose();
        }
        overlayMouseDownRef.current = false;
      }}
      onTouchMove={(e) => e.preventDefault()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        className={`bg-surface border-l border-border w-full h-full flex flex-col shadow-2xl transition-[transform,max-width] duration-200 ease-out overscroll-none ${
          isExpanded ? "max-w-[1400px]" : "max-w-[900px]"
        } ${isVisible ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        {headerSlot ?? (
          <CardModalHeader
            title={title}
            onTitleChange={setTitle}
            displayId={displayId}
            project={project}
            status={status}
            onStatusChange={setStatus}
            projectId={projectId}
            onProjectChange={setProjectId}
            projects={projects}
            groupId={groupId}
            onGroupChange={setGroupId}
            complexity={complexity}
            onComplexityChange={setComplexity}
            priority={priority}
            onPriorityChange={setPriority}
            aiPlatform={aiPlatform}
            onAiPlatformChange={setAiPlatform}
            hasHistory={cardHistory.length > 0}
            onBack={handleBack}
            onExport={handleExport}
            isExpanded={isExpanded}
            onToggleExpand={() => setIsExpanded(!isExpanded)}
            onClose={handleClose}
            isTitleValid={isTitleValid}
            autoFocusTitle={isDraftMode}
            isReadOnly={effectiveReadOnly}
            sessionsSlot={
              // Drafts have no persisted id, so nothing could be recorded
              // against them yet.
              !isDraftMode && selectedCard ? (
                <CardSessionsPopover cardId={selectedCard.id} />
              ) : null
            }
          />
        )}

        {/* Git Branch Actions for Human Test cards */}
        {status === "test" && gitBranchName && gitBranchStatus === "active" && (
          <div className="mx-6 my-3 border border-ink rounded-lg p-4 bg-paper-cream">
            <div className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                {/* The decision this panel actually asks for, in the tester's
                    words. The branch name and worktree path underneath are the
                    same fact in git's words — useful, but not the question. */}
                <div className="text-sm text-ink">
                  <span className="font-medium">Did this change work?</span>
                </div>
                <div className="flex gap-2 shrink-0">
                  {mergeReality && mergeReality.state !== "ready" ? (
                    <Button
                      onClick={handleCompleteWithoutMerge}
                      disabled={isCompleting || isRollingBack}
                      size="sm"
                      variant="outline"
                      className="border-ink/40 text-ink hover:bg-ink/10 hover:text-ink hover:border-ink/60"
                    >
                      {isCompleting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="mr-2 h-4 w-4" />
                      )}
                      Complete
                    </Button>
                  ) : (
                    <Button
                      onClick={() => setShowMergeConfirmDialog(true)}
                      disabled={isMerging || isCheckingMergeReality}
                      size="sm"
                      className="bg-green-600 hover:bg-green-700"
                    >
                      {isMerging || isCheckingMergeReality ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <GitMerge className="mr-2 h-4 w-4" />
                      )}
                      {mergeReality?.needsCommit ? "Commit & Merge" : "Merge & Complete"}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowRollbackDialog(true)}
                    disabled={isMerging || isRollingBack || isCompleting}
                    className="border-red-500/50 text-red-500 hover:bg-red-500/10 hover:text-red-600 hover:border-red-500 dark:hover:text-red-400"
                  >
                    <Undo2 className="mr-2 h-4 w-4" />
                    Didn&apos;t work
                  </Button>
                </div>
              </div>

              {/* Say what the destructive button costs before it is pressed.
                  The two states need genuinely different sentences: normally the
                  work is thrown away, but once it is already on the default
                  branch nothing can take it back out, and saying "deletes this
                  attempt" there reads as a contradiction. */}
              <p className="text-xs text-muted-foreground">
                {mergeReality && mergeReality.state !== "ready" ? (
                  <>
                    This change is already on {mergeReality.defaultBranch}, so &ldquo;Didn&apos;t
                    work&rdquo; cannot take it back out — it only sends the card to Bugs to be
                    worked on again.
                  </>
                ) : (
                  <>
                    &ldquo;Didn&apos;t work&rdquo; sends the card back to Bugs and nothing from
                    this attempt reaches {mergeReality?.defaultBranch ?? "the main branch"}.
                    You choose whether to keep the code.
                  </>
                )}
              </p>

              {/* Why the merge button is gone: git has nothing left to take. */}
              {mergeReality && mergeReality.state !== "ready" && (
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <GitMerge className="h-3.5 w-3.5 mt-0.5 shrink-0 text-ink" />
                  <span>
                    {mergeReality.state === "missing"
                      ? "This work is no longer on its own branch — it looks like it was already merged or removed elsewhere. Complete moves the card to Completed."
                      : `Everything here is already on ${mergeReality.defaultBranch}, so there is nothing left to merge. Complete moves the card to Completed.`}
                  </span>
                </div>
              )}

              {/* Git's own words for the same thing — real, but not the question
                  being asked, so they stay out of the way until wanted. */}
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => setShowGitDetails((v) => !v)}
                  aria-expanded={showGitDetails}
                  className="self-start inline-flex items-center gap-1.5 rounded-md border border-ink/20 px-2 py-1 text-xs font-medium text-ink hover:bg-ink/[0.06] hover:border-ink/40 transition-colors"
                >
                  <ChevronRight
                    className={`h-3.5 w-3.5 transition-transform ${showGitDetails ? "rotate-90" : ""}`}
                  />
                  <GitBranch className="h-3.5 w-3.5" />
                  {showGitDetails ? "Hide branch details" : "Branch details"}
                </button>
                {showGitDetails && (
                  <div className="flex flex-col gap-1 pl-3 border-l-2 border-border">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <GitBranch className="h-3.5 w-3.5 shrink-0 text-ink" />
                      <span className="font-mono truncate" title={gitBranchName ?? undefined}>
                        {gitBranchName}
                      </span>
                    </div>
                    {gitWorktreeStatus === "active" && gitWorktreePath && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-ink" />
                        <span className="font-mono truncate" title={gitWorktreePath}>
                          {gitWorktreePath.split("/").slice(-3).join("/")}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {gitWorktreeStatus === "active" && runMode !== "none" && (
                <div className="flex items-center gap-2 pt-2 border-t border-border/50 mt-2">
                  {runIsActive ? (
                    <>
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-sm text-muted-foreground">
                        {devServerPort ? (
                          <>
                            Running on port{" "}
                            <span className="font-mono text-foreground">{devServerPort}</span>
                          </>
                        ) : (
                          "Running"
                        )}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleStopDevServer}
                        disabled={isServerLoading}
                        className="ml-auto border-red-500/50 text-red-500 hover:bg-red-500/10 hover:text-red-600 hover:border-red-500 dark:hover:text-red-400"
                      >
                        {isServerLoading ? (
                          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                        ) : (
                          <MonitorStop className="mr-2 h-3 w-3" />
                        )}
                        Stop
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleStartDevServer}
                      disabled={isServerLoading}
                      className="border-ink/40 text-ink hover:bg-ink/10 hover:text-ink hover:border-ink/60"
                    >
                      {isServerLoading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : isOneShotRun ? (
                        <ExternalLink className="mr-2 h-4 w-4" />
                      ) : (
                        <MonitorPlay className="mr-2 h-4 w-4" />
                      )}
                      {runLabels.start}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* The same verdict, for cards that never got a branch. Work done
            outside Ideafy leaves nothing to merge or roll back, but the tester
            still has to say whether it worked — and the Status dropdown is a
            poor place to hide that decision. */}
        {status === "test" && !gitBranchName && isLinkingBranch && (
          <div className="mx-6 my-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Checking for this card&apos;s branch…
          </div>
        )}

        {status === "test" && !gitBranchName && !isLinkingBranch && (
          <div className="mx-6 my-3 border border-ink rounded-lg p-4 bg-paper-cream">
            <div className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm text-ink">
                  <span className="font-medium">
                    {isWorkProject ? "Is this ready?" : "Did this change work?"}
                  </span>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    onClick={() => handleFinishWithoutBranch("completed")}
                    disabled={isCompleting}
                    size="sm"
                    variant="outline"
                    className="border-ink/40 text-ink hover:bg-ink/10 hover:text-ink hover:border-ink/60"
                  >
                    {isCompleting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-2 h-4 w-4" />
                    )}
                    {isWorkProject ? "Done" : "Complete"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleFinishWithoutBranch("bugs")}
                    disabled={isCompleting}
                    className="border-red-500/50 text-red-500 hover:bg-red-500/10 hover:text-red-600 hover:border-red-500 dark:hover:text-red-400"
                  >
                    <Undo2 className="mr-2 h-4 w-4" />
                    {isWorkProject ? "Needs revisions" : <>Didn&apos;t work</>}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {isWorkProject
                  ? "Only the card moves; nothing in the project folder changes."
                  : "This card has no branch of its own, so nothing is merged or deleted — only the card moves."}
              </p>
            </div>
          </div>
        )}

        {/* Git Status Badges */}
        {gitBranchName && gitBranchStatus === "merged" && (
          <div className="mx-6 my-2 flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-green-500/30 bg-green-500/10">
            <GitMerge className="h-4 w-4 text-green-500" />
            <span className="text-green-500 font-medium">Merged</span>
            <span className="font-mono text-muted-foreground text-xs">{gitBranchName}</span>
          </div>
        )}

        {gitBranchName && gitBranchStatus === "rolled_back" && (
          <div className="mx-6 my-2 flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10">
            <Undo2 className="h-4 w-4 text-yellow-500" />
            <span className="text-yellow-500 font-medium">Rolled back</span>
            <span className="font-mono text-muted-foreground text-xs">{gitBranchName}</span>
          </div>
        )}

        {status === "progress" && gitWorktreeStatus === "active" && gitWorktreePath && gitBranchName && (
          <div className="mx-6 my-2 flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-paper-edge bg-paper-cream">
            <FolderGit2 className="h-4 w-4 text-ink" />
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-ink font-medium">Worktree active</span>
                <span className="font-mono text-muted-foreground text-xs">{gitBranchName}</span>
              </div>
              <span className="font-mono text-muted-foreground text-xs truncate" title={gitWorktreePath}>
                {gitWorktreePath.split("/").slice(-3).join("/")}
              </span>
            </div>
          </div>
        )}

        {/* Section Tabs */}
        <CardModalTabs
          activeTab={activeTab}
          onTabChange={setActiveTab}
          sectionValues={sectionValues}
          mode={project?.mode}
        />

        {/* Main Content - Split Panel */}
        <div className="flex-1 overflow-hidden relative">
          <SplitPanel
            leftPanel={
              <SectionEditor
                sectionType={activeTab}
                value={sectionValues[activeTab]}
                onChange={sectionSetters[activeTab]}
                onCardClick={handleCardClick}
                projectId={projectId}
                readOnly={effectiveReadOnly}
                cardId={selectedCard.id}
                aiPlatform={aiPlatform}
              />
            }
            rightPanel={
              !isDraftMode && project?.folderPath ? (
                <ConversationPanel
                  cardId={selectedCard.id}
                  sectionType={activeTab}
                  messages={currentMessages}
                  isLoading={isConversationLoading && streamingMessage?.cardId === selectedCard.id && streamingMessage?.sectionType === activeTab}
                  isBackgroundProcessing={isBackgroundProcessing}
                  streamingMessage={streamingMessage?.cardId === selectedCard.id && streamingMessage?.sectionType === activeTab ? streamingMessage : null}
                  projectPath={project.folderPath}
                  projectId={projectId}
                  testScenarios={testScenarios}
                  sectionContent={sectionValues[activeTab]}
                  onSendMessage={handleSendMessage}
                  onClearHistory={handleClearConversation}
                  onCancel={cancelConversation}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  {isDraftMode ? "Save the card to enable chat" : "Select a project to enable chat"}
                </div>
              )
            }
            defaultLeftWidth={60}
            minLeftWidth={300}
            minRightWidth={280}
          />
        </div>

        {/* Footer */}
        {footerSlot ?? (
          <CardModalFooter
            title={title}
            status={status}
            isDraftMode={isDraftMode}
            canSave={canSave}
            saveStatus={saveStatus}
            onDelete={handleDelete}
            onWithdraw={handleWithdraw}
            onCancel={handleClose}
            onSave={handleSave}
            rightActionsSlot={phaseActions}
            createdAt={selectedCard?.createdAt}
            updatedAt={selectedCard?.updatedAt}
            completedAt={selectedCard?.completedAt}
          />
        )}
      </div>

      {/* Dialogs */}
      <AlertDialog open={showRollbackDialog} onOpenChange={setShowRollbackDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This change didn&apos;t work?</AlertDialogTitle>
            {/* The old copy claimed this checks out main, which it never did,
                and never mentioned where the card lands. Both matter. */}
            <AlertDialogDescription>
              The card goes back to Bugs and its test scenarios are cleared, so the work can
              be attempted again from scratch. Should the code written for this attempt be
              kept?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4 space-y-3">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => handleRollback(false)}
              disabled={isRollingBack}
            >
              {isRollingBack ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <GitBranch className="mr-2 h-4 w-4" />
              )}
              Keep it — I may pick it up again
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start text-destructive hover:text-destructive"
              onClick={() => handleRollback(true)}
              disabled={isRollingBack}
            >
              {isRollingBack ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <X className="mr-2 h-4 w-4" />
              )}
              Delete it — start over next time
            </Button>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRollingBack}>Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showMergeConfirmDialog} onOpenChange={setShowMergeConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge Branch into Main?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This will merge{" "}
                  <span className="font-mono text-xs bg-secondary px-1.5 py-0.5 rounded">
                    {gitBranchName}
                  </span>{" "}
                  into the main branch and move this card to Completed.
                </p>
                <p className="text-sm text-muted-foreground">
                  This action cannot be easily undone. Make sure you have tested the changes.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMerging}>Cancel</AlertDialogCancel>
            <Button
              onClick={() => {
                setShowMergeConfirmDialog(false);
                handleMerge();
              }}
              disabled={isMerging}
              className="bg-green-600 hover:bg-green-700"
            >
              {isMerging ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <GitMerge className="mr-2 h-4 w-4" />
              )}
              Merge & Complete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showCommitFirstDialog} onOpenChange={setShowCommitFirstDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Uncommitted Changes</AlertDialogTitle>
            <AlertDialogDescription>
              {commitFirstScope === "worktree"
                ? "There are uncommitted changes in the worktree. Would you like to commit these changes and proceed with the merge?"
                : "There are uncommitted changes in the main repository. Would you like to commit these changes and proceed with the merge?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMerging}>Cancel</AlertDialogCancel>
            <Button
              onClick={handleCommitAndMerge}
              disabled={isMerging}
              className="bg-green-600 hover:bg-green-700"
            >
              {isMerging ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <GitMerge className="mr-2 h-4 w-4" />
              )}
              Commit & Merge
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDiscardDraftDialog} onOpenChange={setShowDiscardDraftDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to close without saving? Your changes will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue Editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleForceClose}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showConflictDialog} onOpenChange={setShowConflictDialog}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-500">
              <AlertTriangle className="h-5 w-5" />
              Rebase Conflict Detected
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  A merge conflict was detected while rebasing{" "}
                  <span className="font-mono text-xs bg-secondary px-1.5 py-0.5 rounded">
                    {conflictInfo?.branchName}
                  </span>{" "}
                  onto main.
                </p>
                {conflictInfo?.conflictFiles && conflictInfo.conflictFiles.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">Conflicting files:</p>
                    <ul className="text-xs font-mono bg-secondary/50 rounded p-2 space-y-1">
                      {conflictInfo.conflictFiles.map((file) => (
                        <li key={file} className="text-red-400">
                          {file}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">
                  The card will remain in Human Test with a conflict badge until resolved.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <Button
              onClick={handleSolveConflictWithAI}
              className="bg-orange-500 hover:bg-orange-600"
            >
              <Terminal className="mr-2 h-4 w-4" />
              Solve with AI
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </CardModalContext.Provider>
  );
}
