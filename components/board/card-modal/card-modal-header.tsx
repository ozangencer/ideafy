"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronsRight, ArrowLeft, FileDown, Maximize2, Minimize2, User } from "lucide-react";
import { Status, COLUMNS, Complexity, Priority, COMPLEXITY_OPTIONS, PRIORITY_OPTIONS, AiPlatform, AI_PLATFORM_OPTIONS } from "@/lib/types";
import { Project } from "@/lib/types";
import type { TeamMember } from "@/lib/team/types";

interface CardModalHeaderProps {
  title: string;
  onTitleChange: (title: string) => void;
  displayId: string | null;
  project: Project | undefined;
  status: Status;
  onStatusChange: (status: Status) => void;
  projectId: string | null;
  onProjectChange: (projectId: string | null) => void;
  projects: Project[];
  complexity: Complexity;
  onComplexityChange: (complexity: Complexity) => void;
  priority: Priority;
  onPriorityChange: (priority: Priority) => void;
  aiPlatform: AiPlatform | null;
  onAiPlatformChange: (platform: AiPlatform | null) => void;
  assignedTo: string | null;
  assignedToName: string | null;
  onAssigneeChange: (userId: string | null, displayName: string | null) => void;
  teamMembers: TeamMember[];
  hasTeam: boolean;
  hasHistory: boolean;
  onBack: () => void;
  onExport: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
  isTitleValid: boolean;
  isReadOnly?: boolean;
}

export function CardModalHeader({
  title,
  onTitleChange,
  displayId,
  project,
  status,
  onStatusChange,
  projectId,
  onProjectChange,
  projects,
  complexity,
  onComplexityChange,
  priority,
  onPriorityChange,
  aiPlatform,
  onAiPlatformChange,
  assignedTo,
  assignedToName,
  onAssigneeChange,
  teamMembers,
  hasTeam,
  hasHistory,
  onBack,
  onExport,
  isExpanded,
  onToggleExpand,
  onClose,
  isTitleValid,
  isReadOnly,
}: CardModalHeaderProps) {
  return (
    <div className="shrink-0 border-b border-border">
      {/* Title row */}
      <div className="flex items-start gap-3 px-6 py-4">
        {/* Close button (Notion-style >>) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground shrink-0 mt-1"
            >
              <ChevronsRight className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Close panel</TooltipContent>
        </Tooltip>
        <div className="flex-1 min-w-0">
          {displayId && (
            <div className="mb-2">
              <span
                className="text-xs font-mono px-2 py-1 rounded"
                style={{
                  backgroundColor: project ? `${project.color}20` : undefined,
                  color: project?.color,
                }}
              >
                {displayId}
              </span>
            </div>
          )}
          <input
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            readOnly={isReadOnly}
            className={`bg-transparent border-none outline-none w-full text-foreground p-0 ${
              !isTitleValid ? "placeholder:text-muted-foreground/50" : ""
            } ${isReadOnly ? "cursor-default" : ""}`}
            style={{ fontSize: "1.75rem", fontWeight: 700, lineHeight: 1.2 }}
            placeholder="New Title"
          />
          {!isTitleValid && (
            <p className="text-xs text-destructive mt-1">Title is required</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {hasHistory && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              className="text-muted-foreground hover:text-foreground"
              title="Go back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onExport}
                className="text-muted-foreground hover:text-foreground"
              >
                <FileDown className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Export as Markdown</TooltipContent>
          </Tooltip>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleExpand}
            className="text-muted-foreground hover:text-foreground"
            title={isExpanded ? "Collapse panel" : "Expand panel"}
          >
            {isExpanded ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Metadata row */}
      <div className={`px-6 pb-4 grid gap-3 ${hasTeam ? "grid-cols-6" : "grid-cols-5"}`}>
        {/* Status */}
        <div>
          <label className="block text-xs text-muted-foreground mb-1.5">Status</label>
          <Select value={status} onValueChange={(v) => onStatusChange(v as Status)} disabled={isReadOnly}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              {COLUMNS.map((col) => (
                <SelectItem key={col.id} value={col.id}>
                  {col.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Project */}
        <div>
          <label className="block text-xs text-muted-foreground mb-1.5">
            Project <span className="text-destructive">*</span>
          </label>
          <Select
            value={projectId || "none"}
            onValueChange={(v) => onProjectChange(v === "none" ? null : v)}
            disabled={isReadOnly}
          >
            <SelectTrigger className={`h-8 text-sm ${!projectId ? "border-destructive" : ""}`}>
              <SelectValue placeholder="Select project">
                {projectId ? (
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{
                        backgroundColor: projects.find((p) => p.id === projectId)?.color || "#5e6ad2",
                      }}
                    />
                    <span className="truncate">
                      {projects.find((p) => p.id === projectId)?.name || "Select project"}
                    </span>
                  </div>
                ) : (
                  "Select project"
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                    <span>{p.name}</span>
                    <span className="text-xs text-muted-foreground ml-1">{p.idPrefix}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Complexity */}
        <div>
          <label className="block text-xs text-muted-foreground mb-1.5">Complexity</label>
          <Select value={complexity} onValueChange={(v) => onComplexityChange(v as Complexity)} disabled={isReadOnly}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue>
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{
                      backgroundColor: COMPLEXITY_OPTIONS.find((o) => o.value === complexity)?.color || "#eab308",
                    }}
                  />
                  <span>{COMPLEXITY_OPTIONS.find((o) => o.value === complexity)?.label || "Medium"}</span>
                </div>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COMPLEXITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: opt.color }} />
                    <span>{opt.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Priority */}
        <div>
          <label className="block text-xs text-muted-foreground mb-1.5">Priority</label>
          <Select value={priority} onValueChange={(v) => onPriorityChange(v as Priority)} disabled={isReadOnly}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue>
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{
                      backgroundColor: PRIORITY_OPTIONS.find((o) => o.value === priority)?.color || "#3b82f6",
                    }}
                  />
                  <span>{PRIORITY_OPTIONS.find((o) => o.value === priority)?.label || "Medium"}</span>
                </div>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: opt.color }} />
                    <span>{opt.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* AI Platform */}
        <div>
          <label className="block text-xs text-muted-foreground mb-1.5">AI Platform</label>
          <Select
            value={aiPlatform || "global"}
            onValueChange={(v) => onAiPlatformChange(v === "global" ? null : v as AiPlatform)}
            disabled={isReadOnly}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue>
                <span className={aiPlatform ? "text-foreground" : "text-muted-foreground"}>
                  {aiPlatform
                    ? AI_PLATFORM_OPTIONS.find((o) => o.value === aiPlatform)?.label || aiPlatform
                    : "Global Default"}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global">
                <span className="text-muted-foreground">Global Default</span>
              </SelectItem>
              {AI_PLATFORM_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <div className="flex flex-col">
                    <span>{opt.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Assignee - only visible when project has a team */}
        {hasTeam && (
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">Assignee</label>
            <Select
              value={assignedTo || "unassigned"}
              disabled={isReadOnly}
              onValueChange={(v) => {
                if (v === "unassigned") {
                  onAssigneeChange(null, null);
                } else {
                  const member = teamMembers.find((m) => m.userId === v);
                  onAssigneeChange(v, member?.displayName || null);
                }
              }}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue>
                  {assignedTo ? (
                    <div className="flex items-center gap-2">
                      <User className="h-3 w-3 text-muted-foreground" />
                      <span className="truncate">{assignedToName || "Unknown"}</span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">Unassigned</span>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">
                  <span className="text-muted-foreground">Unassigned</span>
                </SelectItem>
                {teamMembers.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    <div className="flex items-center gap-2">
                      <User className="h-3 w-3" />
                      <span>{m.displayName}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  );
}
