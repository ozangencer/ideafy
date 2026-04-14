"use client";

import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Card, getDisplayId, COLUMNS } from "@/lib/types";
import { parseTestProgress } from "@/lib/test-progress";
import { useKanbanStore } from "@/lib/store";
import { Play, Loader2, Terminal, Lightbulb, FlaskConical, ExternalLink, ArrowRightLeft, Trash2, Zap, Unlock, Brain, MessagesSquare, FileDown, FolderGit2, MonitorPlay, MonitorStop, AlertTriangle, Check, GitCommitHorizontal, X } from "lucide-react";
import { downloadCardAsMarkdown } from "@/lib/card-export";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Decode HTML entities and strip tags for preview text
function stripHtml(html: string): string {
  if (!html) return "";
  // First decode common HTML entities
  const decoded = html
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x22;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
  // Then strip HTML tags
  return decoded.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// Priority icon with bars (3 levels)
function PriorityIcon({ priority }: { priority: string }) {
  const levels = {
    low: 1,
    medium: 2,
    high: 3,
  };
  const colors = {
    low: "#6b7280",
    medium: "#3b82f6",
    high: "#ef4444",
  };

  const level = levels[priority as keyof typeof levels] || 2;
  const color = colors[priority as keyof typeof colors] || "#3b82f6";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className="shrink-0"
          >
            {[0, 1, 2].map((i) => (
              <rect
                key={i}
                x={i * 4}
                y={9 - (i + 1) * 3}
                width="3"
                height={(i + 1) * 3}
                rx="0.5"
                fill={i < level ? color : "currentColor"}
                opacity={i < level ? 1 : 0.15}
              />
            ))}
          </svg>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        Priority: {priority.charAt(0).toUpperCase() + priority.slice(1)}
      </TooltipContent>
    </Tooltip>
  );
}

interface TaskCardProps {
  card: Card;
  isDragging?: boolean;
}

type Phase = "planning" | "implementation" | "retest";

function detectPhase(card: Card): Phase {
  // In Progress sütunundaki kartlar için direkt implementation
  if (card.status === "progress") {
    const hasTests = card.testScenarios && stripHtml(card.testScenarios) !== "";
    return hasTests ? "retest" : "implementation";
  }

  // Diğer sütunlar için mevcut mantık
  const hasSolution = card.solutionSummary && stripHtml(card.solutionSummary) !== "";
  const hasTests = card.testScenarios && stripHtml(card.testScenarios) !== "";

  if (!hasSolution) return "planning";
  if (!hasTests) return "implementation";
  return "retest";
}

function getPhaseLabels(phase: Phase): { play: string; terminal: string } {
  switch (phase) {
    case "planning":
      return {
        play: "Plan Task (Autonomous)",
        terminal: "Plan Task (Interactive)",
      };
    case "implementation":
      return {
        play: "Implement (Autonomous)",
        terminal: "Implement (Interactive)",
      };
    case "retest":
      return {
        play: "Re-test (Autonomous)",
        terminal: "Fix Issues (Interactive)",
      };
  }
}

export function TaskCard({ card, isDragging = false }: TaskCardProps) {
  const { selectCard, openModal, projects, startTask, startingCardId, openTerminal, openIdeationTerminal, openTestTerminal, moveCard, deleteCard, quickFixTask, quickFixingCardId, evaluateIdea, evaluatingCardIds, lockedCardIds, unlockCard, settings, startDevServer, stopDevServer } = useKanbanStore();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showQuickFixConfirm, setShowQuickFixConfirm] = useState(false);
  const [showTerminalConfirm, setShowTerminalConfirm] = useState(false);
  const [showIdeationConfirm, setShowIdeationConfirm] = useState(false);
  const [showAutonomousConfirm, setShowAutonomousConfirm] = useState(false);
  const [showTestTogetherConfirm, setShowTestTogetherConfirm] = useState(false);
  const [isServerLoading, setIsServerLoading] = useState(false);
  const { attributes, listeners, setNodeRef, transform, isDragging: isBeingDragged } = useDraggable({
    id: card.id,
  });

  // Check both local state AND persisted processingType from database
  const isStarting = startingCardId === card.id || card.processingType === "autonomous";
  const isQuickFixing = quickFixingCardId === card.id || card.processingType === "quick-fix";
  const isEvaluating = evaluatingCardIds.includes(card.id) || card.processingType === "evaluate";
  const isLocked = lockedCardIds.includes(card.id) || !!card.processingType;
  // Background processing = auto unlock when done, no manual unlock needed
  const isBackgroundProcessing = isStarting || isQuickFixing || isEvaluating;
  const canStart = !!(card.description && (card.projectId || card.projectFolder) && card.status !== "completed" && card.status !== "test" && card.status !== "ideation");
  const canQuickFix = card.status === "bugs" && !!(card.description && (card.projectId || card.projectFolder));
  const canEvaluate = card.status === "ideation" && !!(card.description && (card.projectId || card.projectFolder));
  const canTestTogether = card.status === "test" && !!(card.testScenarios && stripHtml(card.testScenarios) !== "" && (card.projectId || card.projectFolder));
  const hasAiOpinion = !!stripHtml(card.aiOpinion);

  // Detect current phase for dynamic tooltips
  const phase = detectPhase(card);
  const phaseLabels = getPhaseLabels(phase);

  // Get project info for worktree path calculation
  const project = projects.find((p) => p.id === card.projectId);
  const projectPath = project?.folderPath || card.projectFolder;

  // Calculate expected worktree path for implementation phase
  const getExpectedWorktreePath = () => {
    if (!projectPath) return null;
    // Use existing worktree path if available
    if (card.gitWorktreePath) return card.gitWorktreePath;
    // Calculate expected path based on task number
    if (card.taskNumber && project) {
      const branchName = `${project.idPrefix}-${card.taskNumber}`;
      return `${projectPath}/.worktrees/kanban/${branchName}`;
    }
    return null;
  };
  const expectedWorktreePath = getExpectedWorktreePath();

  const style = {
    transform: CSS.Translate.toString(transform),
    transition: transform ? 'transform 0ms' : 'transform 200ms ease',
    opacity: isBeingDragged ? 0 : 1,
    cursor: isBeingDragged ? 'grabbing' : 'grab',
  };

  const handleClick = () => {
    if (!isDragging && !isBeingDragged && !isLocked) {
      selectCard(card);
      openModal();
    }
  };

  const handleUnlock = (e: React.MouseEvent) => {
    e.stopPropagation();
    unlockCard(card.id);
  };

  const handleStartClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLocked || isStarting || !canStart) return;
    setShowAutonomousConfirm(true);
  };

  const handleStart = async () => {
    setShowAutonomousConfirm(false);
    if (isStarting || !canStart) return;

    const result = await startTask(card.id);
    if (!result.success) {
      console.error("Failed to start task:", result.error);
    }
  };

  const handleOpenTerminalClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLocked || !canStart) return;

    // Check if Ghostty - show confirmation dialog
    const isGhostty = settings?.detectedTerminal === "ghostty" || settings?.terminalApp === "ghostty";
    if (isGhostty) {
      setShowTerminalConfirm(true);
    } else {
      // Not Ghostty, open terminal directly
      handleOpenTerminal();
    }
  };

  const handleOpenTerminal = async () => {
    setShowTerminalConfirm(false);

    const result = await openTerminal(card.id);
    if (!result.success) {
      console.error("Failed to open terminal:", result.error);
    }
  };

  const handleQuickFixClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLocked || !canQuickFix) return;
    setShowQuickFixConfirm(true);
  };

  const handleQuickFix = async () => {
    setShowQuickFixConfirm(false);
    if (isQuickFixing || !canQuickFix) return;

    const result = await quickFixTask(card.id);
    if (!result.success) {
      console.error("Failed to quick fix:", result.error);
    }
  };

  const handleEvaluate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLocked || isEvaluating || !canEvaluate) return;

    const result = await evaluateIdea(card.id);
    if (!result.success) {
      console.error("Failed to evaluate idea:", result.error);
    }
  };

  const handleOpenIdeationTerminalClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLocked || !canEvaluate) return;

    // Check if Ghostty - show confirmation dialog
    const isGhostty = settings?.detectedTerminal === "ghostty" || settings?.terminalApp === "ghostty";
    if (isGhostty) {
      setShowIdeationConfirm(true);
    } else {
      handleOpenIdeationTerminal();
    }
  };

  const handleOpenIdeationTerminal = async () => {
    setShowIdeationConfirm(false);

    const result = await openIdeationTerminal(card.id);
    if (!result.success) {
      console.error("Failed to open ideation terminal:", result.error);
    }
  };

  const handleTestTogetherClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLocked || !canTestTogether) return;

    // Check if Ghostty - show confirmation dialog
    const isGhostty = settings?.detectedTerminal === "ghostty" || settings?.terminalApp === "ghostty";
    if (isGhostty) {
      setShowTestTogetherConfirm(true);
    } else {
      handleOpenTestTerminal();
    }
  };

  const handleOpenTestTerminal = async () => {
    setShowTestTogetherConfirm(false);

    const result = await openTestTerminal(card.id);
    if (!result.success) {
      console.error("Failed to open test terminal:", result.error);
    }
  };

  const handleExportMarkdown = (e: React.MouseEvent) => {
    e.stopPropagation();
    downloadCardAsMarkdown(card, project);
  };

  const handleDevServerToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isServerLoading || isLocked) return;

    setIsServerLoading(true);
    try {
      if (card.devServerPid) {
        // Stop the server
        const result = await stopDevServer(card.id);
        if (!result.success) {
          console.error("Failed to stop dev server:", result.error);
        }
      } else {
        // Start the server
        const result = await startDevServer(card.id);
        if (!result.success) {
          console.error("Failed to start dev server:", result.error);
        }
      }
    } finally {
      setIsServerLoading(false);
    }
  };

  const displayId = getDisplayId(card, project);
  const projectName = project?.name || (card.projectFolder ? card.projectFolder.split("/").pop() : null);

  // Prevent context menu when locked
  const handleContextMenu = (e: React.MouseEvent) => {
    if (isLocked) {
      e.preventDefault();
    }
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={setNodeRef}
            style={style}
            {...(isLocked ? {} : listeners)}
            {...(isLocked ? {} : attributes)}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            className={`bg-card border border-border rounded-md p-3 transition-colors group touch-none select-none relative ${
              isDragging ? "shadow-2xl ring-2 ring-ink/40" : ""
            } ${isBeingDragged ? "z-50" : ""} ${
              isLocked
                ? "opacity-50 cursor-not-allowed"
                : "hover:border-ink/40"
            }`}
          >
            {/* Unlock button - only for interactive locks (terminal), not background processing */}
            {isLocked && !isBackgroundProcessing && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleUnlock}
                    className="absolute top-2 right-2 p-1.5 rounded bg-orange-500/20 text-orange-500 hover:bg-orange-500/30 transition-colors z-10"
                  >
                    <Unlock className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">Unlock</TooltipContent>
              </Tooltip>
            )}


            {/* Title with displayId and priority */}
            <div className={`flex items-start gap-2 mb-1 ${isLocked && !isBackgroundProcessing ? "pr-8" : ""}`}>
              {displayId && (
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0"
                  style={{
                    backgroundColor: project ? `${project.color}20` : undefined,
                    color: project?.color,
                  }}
                >
                  {displayId}
                </span>
              )}
              <h3 className={`text-sm font-medium text-card-foreground transition-colors line-clamp-2 flex-1 ${isLocked ? "" : "group-hover:text-ink"}`}>
                {card.title}
              </h3>
              {!isLocked && <PriorityIcon priority={card.priority} />}
            </div>

            {card.description && (
              <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                {stripHtml(card.description)}
              </p>
            )}

            <div className="flex items-center justify-between">
              {/* Project indicator */}
              {projectName ? (
                <div className="flex items-center gap-1.5">
                  {project && (
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: project.color }}
                    />
                  )}
                  <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                    {projectName}
                  </span>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">No project</span>
              )}

              {/* Badges and Action Buttons */}
              <div className="flex items-center gap-1">
                {/* Interactive Ideation button - hidden when locked */}
                {canEvaluate && !isLocked && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleOpenIdeationTerminalClick}
                        className="p-1 rounded transition-colors bg-cyan-500/10 text-cyan-500/70 hover:bg-cyan-500/20 hover:text-cyan-500"
                      >
                        <MessagesSquare className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Discuss Idea (Interactive)</TooltipContent>
                  </Tooltip>
                )}
                {/* Autonomous Evaluate button - shows spinner when running */}
                {canEvaluate && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleEvaluate}
                        disabled={isEvaluating || isLocked}
                        className={`p-1 rounded transition-colors ${
                          isEvaluating
                            ? "bg-ink/20 text-ink cursor-wait"
                            : isLocked
                            ? "bg-ink/10 text-ink/30 cursor-not-allowed"
                            : "bg-ink/10 text-ink/70 hover:bg-ink/20 hover:text-ink"
                        }`}
                      >
                        {isEvaluating ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <div className="relative">
                            <Brain className="w-3.5 h-3.5" />
                            {hasAiOpinion && (
                              <span className={`absolute -bottom-1 -right-1 flex items-center justify-center w-2.5 h-2.5 rounded-full ${
                                card.aiVerdict === 'negative' ? 'bg-red-500' : 'bg-green-500'
                              }`}>
                                {card.aiVerdict === 'negative' ? (
                                  <X className="w-1.5 h-1.5 text-white" strokeWidth={4} />
                                ) : (
                                  <Check className="w-1.5 h-1.5 text-white" strokeWidth={4} />
                                )}
                              </span>
                            )}
                          </div>
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {isEvaluating ? "Evaluating..." : hasAiOpinion ? "Re-evaluate Idea" : "Evaluate Idea"}
                    </TooltipContent>
                  </Tooltip>
                )}
                {/* Autonomous QuickFix button - shows spinner when running */}
                {canQuickFix && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleQuickFixClick}
                        disabled={isQuickFixing || isLocked}
                        className={`p-1 rounded transition-colors ${
                          isQuickFixing
                            ? "bg-yellow-500/20 text-yellow-500 cursor-wait"
                            : isLocked
                            ? "bg-yellow-500/10 text-yellow-500/30 cursor-not-allowed"
                            : "bg-yellow-500/10 text-yellow-500/70 hover:bg-yellow-500/20 hover:text-yellow-500"
                        }`}
                      >
                        {isQuickFixing ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Zap className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {isQuickFixing ? "Quick fixing..." : "Quick Fix (No Plan)"}
                    </TooltipContent>
                  </Tooltip>
                )}
                {/* Terminal button - hidden when locked */}
                {canStart && !isLocked && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleOpenTerminalClick}
                        className="p-1 rounded transition-colors bg-orange-500/10 text-orange-500/70 hover:bg-orange-500/20 hover:text-orange-500"
                      >
                        <Terminal className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">{phaseLabels.terminal}</TooltipContent>
                  </Tooltip>
                )}
                {/* Autonomous button - shows spinner when running, hidden only for retest phase */}
                {canStart && phase !== "retest" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleStartClick}
                        disabled={isStarting || isLocked}
                        className={`p-1 rounded transition-colors ${
                          isStarting
                            ? "bg-ink/20 text-ink cursor-wait"
                            : isLocked
                            ? "bg-ink/10 text-ink/30 cursor-not-allowed"
                            : "bg-ink/10 text-ink/70 hover:bg-ink/20 hover:text-ink"
                        }`}
                      >
                        {isStarting ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Play className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {isStarting ? "Running..." : phaseLabels.play}
                    </TooltipContent>
                  </Tooltip>
                )}
                {/* Test Together button - hidden when locked */}
                {canTestTogether && !isLocked && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleTestTogetherClick}
                        className="p-1 rounded transition-colors bg-emerald-500/10 text-emerald-500/70 hover:bg-emerald-500/20 hover:text-emerald-500"
                      >
                        <FlaskConical className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Test Together (Interactive)</TooltipContent>
                  </Tooltip>
                )}
                {card.status === "test" && card.gitWorktreeStatus === "active" && !isLocked && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleDevServerToggle}
                        disabled={isServerLoading}
                        className={`p-1 rounded transition-colors ${
                          card.devServerPid
                            ? "bg-green-500/20 text-green-500 hover:bg-red-500/20 hover:text-red-500"
                            : "bg-cyan-500/10 text-cyan-500/70 hover:bg-cyan-500/20 hover:text-cyan-500"
                        }`}
                      >
                        {isServerLoading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : card.devServerPid ? (
                          <MonitorStop className="w-3.5 h-3.5" />
                        ) : (
                          <MonitorPlay className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {isServerLoading
                        ? "Loading..."
                        : card.devServerPid
                        ? `Stop Server (port ${card.devServerPort})`
                        : "Start Dev Server"}
                    </TooltipContent>
                  </Tooltip>
                )}
                {/* Conflict badge - shows when rebase conflict detected */}
                {card.rebaseConflict && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="p-1 rounded bg-red-500/20 text-red-500 animate-pulse">
                        <AlertTriangle className="w-3 h-3" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Merge conflict detected
                      {card.conflictFiles && card.conflictFiles.length > 0 && (
                        <span className="block text-xs opacity-75">
                          {card.conflictFiles.length} file(s) in conflict
                        </span>
                      )}
                    </TooltipContent>
                  </Tooltip>
                )}
                {card.gitWorktreeStatus === "active" && !isBackgroundProcessing && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="p-1 rounded bg-cyan-500/15 text-cyan-500">
                        <FolderGit2 className="w-3 h-3" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">Worktree active</TooltipContent>
                  </Tooltip>
                )}
                {/* Show "Main" badge when project has worktrees disabled */}
                {project && !project.useWorktrees && !isBackgroundProcessing && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="p-1 rounded bg-gray-500/15 text-gray-400">
                        <GitCommitHorizontal className="w-3 h-3" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">Direct on main (no worktree)</TooltipContent>
                  </Tooltip>
                )}
                {stripHtml(card.solutionSummary) && !isBackgroundProcessing && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="p-1 rounded bg-green-500/15 text-green-500">
                        <Lightbulb className="w-3 h-3" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">Has solution</TooltipContent>
                  </Tooltip>
                )}
                {stripHtml(card.testScenarios) && !isBackgroundProcessing && (() => {
                  const progress = parseTestProgress(card.testScenarios);
                  const isComplete = progress && progress.checked === progress.total;
                  return (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className={`p-1 rounded flex items-center gap-1 ${
                          isComplete
                            ? "bg-green-500/15 text-green-500"
                            : "bg-ink/10 text-ink"
                        }`}>
                          <FlaskConical className="w-3 h-3" />
                          {progress && (
                            <span className="text-[10px] font-mono">
                              {progress.checked}/{progress.total}
                            </span>
                          )}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {progress
                          ? `Tests: ${progress.checked}/${progress.total} completed`
                          : "Has tests"
                        }
                      </TooltipContent>
                    </Tooltip>
                  );
                })()}
              </div>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onClick={handleClick}>
            <ExternalLink className="w-4 h-4 mr-2" />
            Open Details
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <ArrowRightLeft className="w-4 h-4 mr-2" />
              Change Status
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-40">
              {COLUMNS.map((col) => (
                <ContextMenuItem
                  key={col.id}
                  onClick={() => moveCard(card.id, col.id)}
                  disabled={card.status === col.id}
                >
                  {col.title}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem onClick={handleExportMarkdown}>
            <FileDown className="w-4 h-4 mr-2" />
            Export as Markdown
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => setShowDeleteConfirm(true)}
            className="text-red-500 focus:text-red-500"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Card</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{card.title}&quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteCard(card.id)}
              className="bg-red-500 hover:bg-red-600"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showQuickFixConfirm} onOpenChange={setShowQuickFixConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quick Fix Mode</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Are you sure you want to start this card in quick-fix mode?</p>
                <p>
                  <strong className="text-amber-500">Warning:</strong> No plan will be written. This runs in autonomous mode with full file access.
                  After the bug fix is completed, the card will automatically be moved to the Human Test column.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleQuickFix}
              className="bg-yellow-500 hover:bg-yellow-600 text-black"
            >
              Start Quick Fix
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showTerminalConfirm} onOpenChange={setShowTerminalConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Open Interactive Terminal</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  <strong>Tip:</strong> Use <kbd className="px-1.5 py-0.5 bg-secondary border border-border rounded text-xs">⌘V</kbd> to paste in Ghostty terminal.
                </p>
                {phase === "implementation" && (
                  project?.useWorktrees === false ? (
                    <p className="text-gray-400 text-xs font-mono">
                      Working directly on main (worktrees disabled)
                    </p>
                  ) : expectedWorktreePath && (
                    <p className="text-cyan-500 text-xs font-mono">
                      Worktree: {expectedWorktreePath.split('/').slice(-3).join('/')}
                    </p>
                  )
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleOpenTerminal}
              className="bg-orange-500 hover:bg-orange-600"
            >
              Open Terminal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showIdeationConfirm} onOpenChange={setShowIdeationConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Interactive Ideation</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>Tip:</strong> Use <kbd className="px-1.5 py-0.5 bg-secondary border border-border rounded text-xs">⌘V</kbd> to paste in Ghostty terminal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleOpenIdeationTerminal}
              className="bg-cyan-500 hover:bg-cyan-600"
            >
              Start Discussion
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showTestTogetherConfirm} onOpenChange={setShowTestTogetherConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Test Together</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Start an interactive test session with Claude as your QA partner.</p>
                <p>
                  <strong>Tip:</strong> Use <kbd className="px-1.5 py-0.5 bg-secondary border border-border rounded text-xs">⌘V</kbd> to paste in Ghostty terminal.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleOpenTestTerminal}
              className="bg-emerald-500 hover:bg-emerald-600"
            >
              Start Testing
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showAutonomousConfirm} onOpenChange={setShowAutonomousConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start {phaseLabels.play}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>This will run in autonomous mode with full file access.</p>
                {phase === "planning" && (
                  <p className="text-muted-foreground">
                    The task will be analyzed and a solution plan will be written.
                  </p>
                )}
                {phase === "implementation" && (
                  <div className="space-y-1">
                    {project?.useWorktrees === false ? (
                      <p className="text-amber-500">
                        Files in your project may be modified. Working directly on main branch.
                      </p>
                    ) : (
                      <>
                        <p className="text-amber-500">
                          Files in your project may be modified. A new worktree will be created automatically.
                        </p>
                        {expectedWorktreePath && (
                          <p className="text-cyan-500 text-xs font-mono">
                            {expectedWorktreePath.split('/').slice(-3).join('/')}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
                {phase === "retest" && (
                  <p className="text-muted-foreground">
                    Tests will be re-run and any issues will be fixed.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleStart}>
              Start
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
