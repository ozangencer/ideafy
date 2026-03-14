"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { TeamMember } from "@/lib/team/types";
import { useKanbanStore } from "@/lib/store";
import {
  Status,
  getDisplayId,
  Complexity,
  Priority,
  AiPlatform,
  GitBranchStatus,
  GitWorktreeStatus,
  SectionType,
  SECTION_CONFIG,
  MentionData,
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
  AlertTriangle,
  Terminal,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { downloadCardAsMarkdown } from "@/lib/card-export";

// New modular components
import { CardModalHeader } from "./card-modal-header";
import { CardModalTabs } from "./card-modal-tabs";
import { CardModalFooter } from "./card-modal-footer";
import { SplitPanel } from "./split-panel";
import { SectionEditor } from "./sections/section-editor";
import { ConversationPanel } from "./sections/conversation-panel";
import { sendAssignmentNotification } from "@/lib/team/notifications-client";

export function CardModal() {
  const {
    selectedCard,
    closeModal,
    updateCard,
    deleteCard,
    removeFromPool,
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
    clearConversation,
    // Background processes
    backgroundProcesses,
    fetchBackgroundProcesses,
    // Team
    teamMembers,
    teamMembersByTeamId,
    fetchMembersForTeam,
    poolCards,
    currentUser,
  } = useKanbanStore();
  const { toast } = useToast();

  // Check if we're in draft mode (creating a new card)
  const isDraftMode = selectedCard?.id.startsWith("draft-") ?? false;

  // Pool lock: card is in pool but not claimed by current user → read-only
  const poolCard = selectedCard?.poolCardId ? poolCards.find((pc) => pc.id === selectedCard.poolCardId) : null;
  const isReadOnly = !!selectedCard?.poolCardId && (!poolCard || poolCard.assignedTo !== currentUser?.id);

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
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [assignedToName, setAssignedToName] = useState<string | null>(null);

  // UI state
  const [isVisible, setIsVisible] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<SectionType>("detail");
  const [cardHistory, setCardHistory] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  // Git state
  const [gitBranchName, setGitBranchName] = useState<string | null>(null);
  const [gitBranchStatus, setGitBranchStatus] = useState<GitBranchStatus>(null);
  const [gitWorktreePath, setGitWorktreePath] = useState<string | null>(null);
  const [gitWorktreeStatus, setGitWorktreeStatus] = useState<GitWorktreeStatus>(null);
  const [isMerging, setIsMerging] = useState(false);
  const [showRollbackDialog, setShowRollbackDialog] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [showCommitFirstDialog, setShowCommitFirstDialog] = useState(false);
  const [showDiscardDraftDialog, setShowDiscardDraftDialog] = useState(false);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
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

  // Track previous assignee for notification
  const prevAssignedToRef = useRef<string | null>(null);

  // Track unsaved changes
  const hasUnsavedChanges = selectedCard && (
    title !== selectedCard.title ||
    description !== selectedCard.description ||
    solutionSummary !== selectedCard.solutionSummary ||
    testScenarios !== selectedCard.testScenarios ||
    aiOpinion !== selectedCard.aiOpinion ||
    status !== selectedCard.status ||
    complexity !== (selectedCard.complexity || "medium") ||
    priority !== (selectedCard.priority || "medium") ||
    projectId !== selectedCard.projectId ||
    aiPlatform !== (selectedCard.aiPlatform ?? null) ||
    assignedTo !== (selectedCard.assignedTo ?? null) ||
    assignedToName !== (selectedCard.assignedToName ?? null)
  );

  // Check if draft has any user-entered content
  const hasDraftChanges = isDraftMode && (
    title.trim() !== "" ||
    description.trim() !== "" ||
    solutionSummary.trim() !== "" ||
    testScenarios.trim() !== "" ||
    aiOpinion.trim() !== ""
  );

  // Get project and displayId
  const project = projects.find((p) => p.id === projectId);
  const displayId = selectedCard ? getDisplayId(selectedCard, project) : null;

  // Check if save should be disabled
  const isTitleValid = (title || "").trim().length > 0;
  const canSave = projectId !== null && isTitleValid;

  // Check if the selected project has a team linked
  const hasTeam = !!(project?.teamId);

  // Resolve team members for the project's team (not necessarily the active team)
  const projectTeamMembers: TeamMember[] = useMemo(() => {
    if (!project?.teamId) return [];
    return teamMembersByTeamId[project.teamId] || [];
  }, [project?.teamId, teamMembersByTeamId]);

  // Fetch members for the project's team when modal opens or project changes
  useEffect(() => {
    if (project?.teamId) {
      fetchMembersForTeam(project.teamId);
    }
  }, [project?.teamId, fetchMembersForTeam]);

  // Send notification when assignee changes to someone else
  useEffect(() => {
    if (!selectedCard || isDraftMode || !hasTeam || !project?.teamId) return;
    if (prevAssignedToRef.current === null && assignedTo === null) return;
    if (prevAssignedToRef.current === assignedTo) return;

    // Only send notification if assigned to a new person (not unassign, not self)
    if (assignedTo && assignedTo !== prevAssignedToRef.current) {
      sendAssignmentNotification({
        recipientUserId: assignedTo,
        teamId: project.teamId,
        cardTitle: title || selectedCard.title,
        referenceId: selectedCard.id,
      });
    }

    prevAssignedToRef.current = assignedTo;
  }, [assignedTo, selectedCard, isDraftMode, hasTeam, project?.teamId, title]);

  // Auto-save debounce ref
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const savedTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Track when MCP tool updates arrive to prevent auto-save overwriting them
  const lastMcpUpdateRef = useRef<number>(0);

  // Auto-save effect for edit mode
  useEffect(() => {
    // Only auto-save for existing cards (not drafts) with valid data, not read-only
    if (!selectedCard || isDraftMode || isReadOnly || !canSave || !hasUnsavedChanges) {
      return;
    }

    // Clear any existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounced save after 500ms
    saveTimeoutRef.current = setTimeout(() => {
      // Skip auto-save if an MCP tool update arrived recently (within 1000ms)
      // This prevents overwriting values set by save_plan, save_tests, etc.
      if (Date.now() - lastMcpUpdateRef.current < 1000) {
        return;
      }

      setSaveStatus("saving");

      const selectedProject = projects.find((p) => p.id === projectId);

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
        assignedTo,
        assignedToName,
        projectFolder: selectedProject?.folderPath || selectedCard.projectFolder,
      });

      setSaveStatus("saved");

      // Clear saved status after 2 seconds
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
    assignedTo,
    assignedToName,
    projects,
    updateCard,
  ]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    };
  }, []);

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

  // Load card data when selected
  useEffect(() => {
    if (selectedCard) {
      requestAnimationFrame(() => setIsVisible(true));
    } else {
      setIsVisible(false);
    }
  }, [selectedCard]);

  useEffect(() => {
    if (selectedCard) {
      // Cancel any pending auto-save when selectedCard changes externally
      // This prevents auto-save from overwriting MCP tool updates
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        setSaveStatus("idle");
      }
      // Mark this as an external update (possibly from MCP tool calls)
      lastMcpUpdateRef.current = Date.now();

      setTitle(selectedCard.title);
      setDescription(selectedCard.description);
      setSolutionSummary(selectedCard.solutionSummary);
      setTestScenarios(selectedCard.testScenarios);
      setAiOpinion(selectedCard.aiOpinion);
      setStatus(selectedCard.status);
      setComplexity(selectedCard.complexity || "medium");
      setPriority(selectedCard.priority || "medium");
      setProjectId(selectedCard.projectId);
      setAiPlatform(selectedCard.aiPlatform ?? null);
      setAssignedTo(selectedCard.assignedTo ?? null);
      setAssignedToName(selectedCard.assignedToName ?? null);
      prevAssignedToRef.current = selectedCard.assignedTo ?? null;
      setGitBranchName(selectedCard.gitBranchName);
      setGitBranchStatus(selectedCard.gitBranchStatus);
      setGitWorktreePath(selectedCard.gitWorktreePath);
      setGitWorktreeStatus(selectedCard.gitWorktreeStatus);
      setDevServerPort(selectedCard.devServerPort);
      setDevServerPid(selectedCard.devServerPid);

      // Auto-open Test tab when card is in Human Test column
      if (selectedCard.status === "test") {
        setActiveTab("tests");
      }

      // Fetch conversation for active tab
      if (!isDraftMode) {
        fetchConversation(selectedCard.id, activeTab);
      }
    }
  }, [selectedCard, isDraftMode, fetchConversation]);

  // Fetch conversation when tab changes
  useEffect(() => {
    if (selectedCard && !isDraftMode) {
      fetchConversation(selectedCard.id, activeTab);
    }
  }, [activeTab, selectedCard, isDraftMode, fetchConversation]);

  // Poll background processes to detect running chat streams
  useEffect(() => {
    if (!selectedCard || isDraftMode) return;

    // Initial fetch
    fetchBackgroundProcesses();

    // Poll every 2 seconds while modal is open
    const interval = setInterval(() => {
      fetchBackgroundProcesses();
    }, 2000);

    return () => clearInterval(interval);
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

  // Handle card mention click
  const handleCardClick = useCallback((cardId: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (card && card.id !== selectedCard?.id) {
      if (selectedCard) {
        setCardHistory((prev) => [...prev, selectedCard.id]);
      }
      selectCard(card);
      openModal();
    }
  }, [cards, selectedCard, selectCard, openModal]);

  // Handle back navigation
  const handleBack = useCallback(() => {
    if (cardHistory.length > 0) {
      const newHistory = [...cardHistory];
      const previousCardId = newHistory.pop();
      setCardHistory(newHistory);

      if (previousCardId) {
        const previousCard = cards.find((c) => c.id === previousCardId);
        if (previousCard) {
          selectCard(previousCard);
        }
      }
    }
  }, [cardHistory, cards, selectCard]);

  // Handle close
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

  // Force close (used by discard confirmation dialog)
  const handleForceClose = useCallback(() => {
    setShowDiscardDraftDialog(false);
    setCardHistory([]);
    setIsVisible(false);
    detachConversation();
    setTimeout(() => discardDraft(), 200);
  }, [discardDraft, detachConversation]);

  // Handle export
  const handleExport = useCallback(() => {
    if (selectedCard) {
      downloadCardAsMarkdown(selectedCard, project);
    }
  }, [selectedCard, project]);

  // Handle save
  const handleSave = useCallback(() => {
    if (selectedCard) {
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
          poolCardId: null,
          assignedTo,
          assignedToName,
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
          assignedTo,
          assignedToName,
          projectFolder: selectedProject?.folderPath || selectedCard.projectFolder,
        };
        handleClose();
        updateCard(cardId, updates);
      }
    }
  }, [selectedCard, projects, projectId, isDraftMode, title, description, solutionSummary, testScenarios, aiOpinion, status, complexity, priority, aiPlatform, saveDraftCard, updateCard, handleClose]);

  // Handle delete (pool-aware)
  const handleDelete = useCallback((removeFromPoolFlag?: boolean) => {
    if (selectedCard) {
      deleteCard(selectedCard.id, { removeFromPool: removeFromPoolFlag });
    }
  }, [selectedCard, deleteCard]);

  // Handle remove from pool (keep local card)
  const handleRemoveFromPool = useCallback(async () => {
    if (selectedCard?.poolCardId) {
      const result = await removeFromPool(selectedCard.poolCardId, selectedCard.id);
      if (result.error) {
        toast({ variant: "destructive", title: "Error", description: result.error });
      } else {
        toast({ title: "Removed from pool", description: "Local card remains intact" });
      }
    }
  }, [selectedCard, removeFromPool, toast]);

  // Handle withdraw
  const handleWithdraw = useCallback(() => {
    if (selectedCard) {
      updateCard(selectedCard.id, { status: "withdrawn" });
      handleClose();
    }
  }, [selectedCard, updateCard, handleClose]);

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

        if (error.uncommittedInMain) {
          setShowCommitFirstDialog(true);
          return;
        }

        if (error.rebaseConflict) {
          setConflictInfo({
            conflictFiles: error.conflictFiles || [],
            worktreePath: error.worktreePath || "",
            branchName: error.branchName || "",
            displayId: error.displayId || "",
          });
          setShowConflictDialog(true);
          await useKanbanStore.getState().fetchCards();
          return;
        }

        if (error.uncommittedInWorktree) {
          toast({
            variant: "destructive",
            title: "Uncommitted Changes",
            description: "Please commit your changes in the worktree before merging.",
          });
          return;
        }

        toast({
          variant: "destructive",
          title: "Merge Failed",
          description: error.error || "An error occurred during merge",
        });
        return;
      }

      await useKanbanStore.getState().fetchCards();
      toast({
        title: "Branch Merged",
        description: "Successfully merged and moved to Completed",
      });
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
      if (result.success && result.port) {
        setDevServerPort(result.port);
        const updatedCard = useKanbanStore.getState().cards.find((c) => c.id === selectedCard.id);
        if (updatedCard) {
          setDevServerPid(updatedCard.devServerPid);
        }
        toast({
          title: "Dev Server Started",
          description: `Running on port ${result.port}`,
        });
      } else {
        toast({
          variant: "destructive",
          title: "Failed to Start Server",
          description: result.error || "Unknown error",
        });
      }
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
          title: "Rollback Failed",
          description: error.error || "An error occurred during rollback",
        });
        return;
      }

      await useKanbanStore.getState().fetchCards();
      setShowRollbackDialog(false);
      toast({
        title: "Rolled Back",
        description: deleteBranch ? "Branch deleted, card moved to Bugs" : "Switched to main, branch preserved",
      });
      handleClose();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Rollback Failed",
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

  if (!selectedCard) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-end transition-colors duration-200 ${
        isVisible ? "bg-black/40" : "bg-transparent"
      }`}
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`bg-surface border-l border-border w-full h-full flex flex-col shadow-2xl transition-all duration-200 ease-out ${
          isExpanded ? "max-w-[1400px]" : "max-w-[900px]"
        } ${isVisible ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
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
          complexity={complexity}
          onComplexityChange={setComplexity}
          priority={priority}
          onPriorityChange={setPriority}
          aiPlatform={aiPlatform}
          onAiPlatformChange={setAiPlatform}
          assignedTo={assignedTo}
          assignedToName={assignedToName}
          onAssigneeChange={(userId, displayName) => {
            setAssignedTo(userId);
            setAssignedToName(displayName);
          }}
          teamMembers={projectTeamMembers}
          hasTeam={hasTeam}
          hasHistory={cardHistory.length > 0}
          onBack={handleBack}
          onExport={handleExport}
          isExpanded={isExpanded}
          onToggleExpand={() => setIsExpanded(!isExpanded)}
          onClose={handleClose}
          isTitleValid={isTitleValid}
          isReadOnly={isReadOnly}
        />

        {/* Git Branch Actions for Human Test cards */}
        {status === "test" && gitBranchName && gitBranchStatus === "active" && (
          <div className="mx-6 my-3 border-2 border-blue-500/50 rounded-lg p-4 bg-blue-500/10">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <GitBranch className="h-4 w-4 text-blue-500" />
                  <span className="font-mono text-muted-foreground">{gitBranchName}</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleMerge()}
                    disabled={isMerging}
                    size="sm"
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {isMerging ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <GitMerge className="mr-2 h-4 w-4" />
                    )}
                    Merge & Complete
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowRollbackDialog(true)}
                    disabled={isMerging || isRollingBack}
                    className="border-red-500/50 text-red-500 hover:bg-red-500/10"
                  >
                    <Undo2 className="mr-2 h-4 w-4" />
                    Rollback
                  </Button>
                </div>
              </div>
              {gitWorktreeStatus === "active" && gitWorktreePath && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FolderGit2 className="h-3.5 w-3.5 text-cyan-500" />
                  <span className="font-mono truncate" title={gitWorktreePath}>
                    {gitWorktreePath.split("/").slice(-3).join("/")}
                  </span>
                </div>
              )}
              {gitWorktreeStatus === "active" && (
                <div className="flex items-center gap-2 pt-2 border-t border-border/50 mt-2">
                  {devServerPid ? (
                    <>
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-sm text-muted-foreground">
                        Server running on port <span className="font-mono text-foreground">{devServerPort}</span>
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleStopDevServer}
                        disabled={isServerLoading}
                        className="ml-auto border-red-500/50 text-red-500 hover:bg-red-500/10"
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
                      className="border-cyan-500/50 text-cyan-500 hover:bg-cyan-500/10"
                    >
                      {isServerLoading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <MonitorPlay className="mr-2 h-4 w-4" />
                      )}
                      Start Dev Server
                    </Button>
                  )}
                </div>
              )}
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
          <div className="mx-6 my-2 flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10">
            <FolderGit2 className="h-4 w-4 text-cyan-500" />
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-cyan-500 font-medium">Worktree active</span>
                <span className="font-mono text-muted-foreground text-xs">{gitBranchName}</span>
              </div>
              <span className="font-mono text-muted-foreground text-xs truncate" title={gitWorktreePath}>
                {gitWorktreePath.split("/").slice(-3).join("/")}
              </span>
            </div>
          </div>
        )}

        {/* Section Tabs */}
        <CardModalTabs activeTab={activeTab} onTabChange={setActiveTab} sectionValues={sectionValues} />

        {/* Main Content - Split Panel */}
        <div className="flex-1 overflow-hidden relative">
          <SplitPanel
            leftPanel={
              <SectionEditor
                sectionType={activeTab}
                value={sectionValues[activeTab]}
                onChange={isReadOnly ? () => {} : sectionSetters[activeTab]}
                onCardClick={handleCardClick}
                projectId={projectId}
                readOnly={isReadOnly}
              />
            }
            rightPanel={
              isReadOnly ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  Claim from pool to enable chat
                </div>
              ) : !isDraftMode && project?.folderPath ? (
                <ConversationPanel
                  cardId={selectedCard.id}
                  sectionType={activeTab}
                  messages={currentMessages}
                  isLoading={isConversationLoading}
                  isBackgroundProcessing={isBackgroundProcessing}
                  streamingMessage={streamingMessage?.cardId === selectedCard.id && streamingMessage?.sectionType === activeTab ? streamingMessage : null}
                  projectPath={project.folderPath}
                  projectId={projectId}
                  testScenarios={testScenarios}
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
        {!isReadOnly && (
          <CardModalFooter
            title={title}
            cardId={selectedCard?.id}
            poolCardId={selectedCard?.poolCardId}
            status={status}
            isDraftMode={isDraftMode}
            canSave={canSave}
            saveStatus={saveStatus}
            onDelete={handleDelete}
            onRemoveFromPool={handleRemoveFromPool}
            onWithdraw={handleWithdraw}
            onCancel={handleClose}
            onSave={handleSave}
          />
        )}
      </div>

      {/* Dialogs */}
      <AlertDialog open={showRollbackDialog} onOpenChange={setShowRollbackDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rollback Branch</AlertDialogTitle>
            <AlertDialogDescription>
              This will checkout to the main branch. What would you like to do with the feature branch?
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
              Keep branch (can retry later)
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
              Delete branch (start fresh)
            </Button>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRollingBack}>Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showCommitFirstDialog} onOpenChange={setShowCommitFirstDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Uncommitted Changes</AlertDialogTitle>
            <AlertDialogDescription>
              There are uncommitted changes in the main repository. Would you like to commit these changes and proceed with the merge?
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
  );
}
