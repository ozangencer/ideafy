"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useKanbanStore } from "@/lib/store";
import { toast } from "@/hooks/use-toast";
import { COLUMNS, Complexity, Priority, Project, Status } from "@/lib/types";
import { X, Brain } from "lucide-react";

const STATUS_MAP: Record<string, Status> = {
  "/idea": "ideation",
  "/ideation": "ideation",
  "/backlog": "backlog",
  "/bug": "bugs",
  "/bugs": "bugs",
  "/progress": "progress",
  "/test": "test",
};

const COMPLEXITY_MAP: Record<string, Complexity> = {
  "c:low": "low",
  "c:medium": "medium",
  "c:high": "high",
};

export function QuickEntryOverlay() {
  const {
    isQuickEntryOpen,
    closeQuickEntry,
    addCard,
    evaluateIdea,
    projects,
    activeProjectId,
  } = useKanbanStore();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [status, setStatus] = useState<Status>("backlog");
  const [complexity, setComplexity] = useState<Complexity>("medium");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [autocompleteQuery, setAutocompleteQuery] = useState<string | null>(
    null
  );
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [focusedField, setFocusedField] = useState<"title" | "description">(
    "title"
  );

  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  const resolvedProject = useMemo(() => {
    if (projectId) return projects.find((p) => p.id === projectId) ?? null;
    return projects.find((p) => p.id === activeProjectId) ?? null;
  }, [projectId, projects, activeProjectId]);

  const filteredProjects = useMemo(() => {
    if (autocompleteQuery === null) return [];
    if (autocompleteQuery === "") return projects;
    const q = autocompleteQuery.toLowerCase();
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.idPrefix.toLowerCase().includes(q)
    );
  }, [autocompleteQuery, projects]);

  const showAutocomplete =
    autocompleteQuery !== null && filteredProjects.length > 0;

  // Notify Electron when quick entry closes (so window can re-hide)
  const notifyElectronClosed = useCallback(() => {
    window.dispatchEvent(new CustomEvent("quick-entry-closed"));
  }, []);

  // Wrap closeQuickEntry to also notify Electron
  const handleClose = useCallback(() => {
    closeQuickEntry();
    notifyElectronClosed();
  }, [closeQuickEntry, notifyElectronClosed]);

  useEffect(() => {
    if (isQuickEntryOpen) {
      setTitle("");
      setDescription("");
      setPriority("medium");
      setStatus("backlog");
      setComplexity("medium");
      setProjectId(null);
      setAutocompleteQuery(null);
      setAutocompleteIndex(0);
      setFocusedField("title");
      requestAnimationFrame(() => titleRef.current?.focus());
    }
  }, [isQuickEntryOpen]);

  const handleTitleChange = useCallback((value: string) => {
    let processed = value;

    const atMatch = processed.match(/@([\w\-.]*)$/);
    if (atMatch) {
      setAutocompleteQuery(atMatch[1]);
      setTitle(processed);
      return;
    } else {
      setAutocompleteQuery(null);
    }

    if (/(?:^|\s)!!(?:\s|$)/.test(processed)) {
      setPriority("high");
      processed = processed.replace(/(?:^|\s)!!(?:\s|$)/, " ").trim();
    }

    if (/(?:^|\s)!(?:\s|$)/.test(processed)) {
      setPriority("low");
      processed = processed.replace(/(?:^|\s)!(?:\s|$)/, " ").trim();
    }

    for (const [token, statusValue] of Object.entries(STATUS_MAP)) {
      const regex = new RegExp(
        `(?:^|\\s)${token.replace("/", "\\/")}(?:\\s|$)`
      );
      if (regex.test(processed)) {
        setStatus(statusValue);
        processed = processed.replace(regex, " ").trim();
        break;
      }
    }

    for (const [token, complexityValue] of Object.entries(COMPLEXITY_MAP)) {
      const regex = new RegExp(
        `(?:^|\\s)${token.replace(":", "\\:")}(?:\\s|$)`
      );
      if (regex.test(processed)) {
        setComplexity(complexityValue);
        processed = processed.replace(regex, " ").trim();
        break;
      }
    }

    setTitle(processed);
  }, []);

  const handleSelectProject = useCallback((project: Project) => {
    setProjectId(project.id);
    setTitle((prev) => prev.replace(/@[\w\-.]*$/, "").trim());
    setAutocompleteQuery(null);
    setAutocompleteIndex(0);
    titleRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!title.trim()) return;

    const project = resolvedProject;

    await addCard({
      title: title.trim(),
      description: description.trim(),
      solutionSummary: "",
      testScenarios: "",
      aiOpinion: "",
      aiVerdict: null,
      status,
      complexity,
      priority,
      projectFolder: project?.folderPath ?? "",
      projectId: project?.id ?? null,
      gitBranchName: null,
      gitBranchStatus: null,
      gitWorktreePath: null,
      gitWorktreeStatus: null,
      devServerPort: null,
      devServerPid: null,
      rebaseConflict: null,
      conflictFiles: null,
      processingType: null,
    });

    const columnLabel =
      COLUMNS.find((c) => c.id === status)?.title ?? status;

    toast({
      title: "Card created",
      description: `"${title.trim()}" added to ${columnLabel}`,
    });

    handleClose();
  }, [
    title,
    description,
    status,
    complexity,
    priority,
    resolvedProject,
    addCard,
    handleClose,
  ]);

  const canIdeate = !!(title.trim() && description.trim() && resolvedProject);

  const handleIdeate = useCallback(async () => {
    if (!canIdeate) return;

    const createdCard = await addCard({
      title: title.trim(),
      description: description.trim(),
      solutionSummary: "",
      testScenarios: "",
      aiOpinion: "",
      aiVerdict: null,
      status: "ideation",
      complexity,
      priority,
      projectFolder: resolvedProject?.folderPath ?? "",
      projectId: resolvedProject?.id ?? null,
      gitBranchName: null,
      gitBranchStatus: null,
      gitWorktreePath: null,
      gitWorktreeStatus: null,
      devServerPort: null,
      devServerPid: null,
      rebaseConflict: null,
      conflictFiles: null,
      processingType: null,
    });

    if (createdCard) {
      evaluateIdea(createdCard.id);
      toast({
        title: "Idea created & evaluating",
        description: `"${title.trim()}" added to Ideation`,
      });
    }

    handleClose();
  }, [canIdeate, title, description, complexity, priority, resolvedProject, addCard, evaluateIdea, handleClose]);

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (autocompleteQuery !== null) {
          setAutocompleteQuery(null);
          setTitle((prev) => prev.replace(/@[\w\-.]*$/, "").trim());
        } else {
          handleClose();
        }
        return;
      }

      if (showAutocomplete) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAutocompleteIndex((i) =>
            i < filteredProjects.length - 1 ? i + 1 : 0
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setAutocompleteIndex((i) =>
            i > 0 ? i - 1 : filteredProjects.length - 1
          );
          return;
        }
        if (e.key === "Tab" || e.key === "Enter") {
          e.preventDefault();
          handleSelectProject(filteredProjects[autocompleteIndex]);
          return;
        }
      }

      if (e.key === "i" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleIdeate();
        return;
      }

      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        setFocusedField("description");
        requestAnimationFrame(() => descRef.current?.focus());
        return;
      }

      if (e.key === "Enter" && !showAutocomplete) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [
      handleClose,
      showAutocomplete,
      filteredProjects,
      autocompleteIndex,
      autocompleteQuery,
      handleSelectProject,
      handleSubmit,
      handleIdeate,
    ]
  );

  const handleDescKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
        return;
      }

      if (e.key === "i" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleIdeate();
        return;
      }

      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        setFocusedField("title");
        requestAnimationFrame(() => titleRef.current?.focus());
        return;
      }

      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleClose, handleSubmit, handleIdeate]
  );

  if (!isQuickEntryOpen) return null;

  const statusLabel = COLUMNS.find((c) => c.id === status)?.title;
  const hasBadges =
    resolvedProject ||
    priority !== "medium" ||
    status !== "backlog" ||
    complexity !== "medium";

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-[2px] animate-in fade-in duration-100"
      onClick={handleClose}
    >
      <div
        className="mx-auto mt-[20vh] w-[480px] rounded-lg overflow-hidden bg-[hsl(var(--popover))] border border-white/[0.08] shadow-[0_16px_70px_-12px_rgba(0,0,0,0.8)] animate-in fade-in slide-in-from-top-1 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title */}
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          onKeyDown={handleTitleKeyDown}
          onFocus={() => setFocusedField("title")}
          placeholder="New card"
          className="block w-full bg-transparent border-0 px-5 pt-4 pb-1 text-[15px] font-medium text-foreground placeholder:text-muted-foreground/50 outline-none ring-0 focus:ring-0"
          autoComplete="off"
          spellCheck={false}
        />

        {/* Description */}
        <textarea
          ref={descRef}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={handleDescKeyDown}
          onFocus={() => setFocusedField("description")}
          placeholder="Notes"
          rows={1}
          className="block w-full bg-transparent border-0 px-5 pb-3 pt-0 text-[13px] text-muted-foreground placeholder:text-muted-foreground/30 outline-none ring-0 focus:ring-0 resize-none leading-relaxed"
        />

        {/* Badges */}
        {hasBadges && (
          <div className="px-5 pb-3 flex flex-wrap gap-1.5">
            {resolvedProject && (
              <TokenBadge
                label={resolvedProject.name}
                color={resolvedProject.color}
                onRemove={() => setProjectId(null)}
              />
            )}
            {priority !== "medium" && (
              <TokenBadge
                label={priority === "high" ? "High" : "Low"}
                color={priority === "high" ? "#f87171" : "#9ca3af"}
                onRemove={() => setPriority("medium")}
              />
            )}
            {status !== "backlog" && (
              <TokenBadge
                label={statusLabel ?? status}
                color="#60a5fa"
                onRemove={() => setStatus("backlog")}
              />
            )}
            {complexity !== "medium" && (
              <TokenBadge
                label={complexity}
                color="#facc15"
                onRemove={() => setComplexity("medium")}
              />
            )}
          </div>
        )}

        {/* Autocomplete */}
        {showAutocomplete && (
          <div className="border-t border-white/[0.06]">
            {filteredProjects.map((project, idx) => (
              <button
                key={project.id}
                className={`w-full px-5 py-2 flex items-center gap-2.5 text-[13px] text-left transition-colors ${
                  idx === autocompleteIndex
                    ? "bg-white/[0.06]"
                    : "hover:bg-white/[0.04]"
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelectProject(project);
                }}
                onMouseEnter={() => setAutocompleteIndex(idx)}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: project.color }}
                />
                <span className="text-foreground/90">{project.name}</span>
                <span className="text-muted-foreground/50 text-xs ml-auto">
                  {project.idPrefix}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-2 border-t border-white/[0.06] flex items-center gap-4 text-[11px] text-muted-foreground/40">
          <span>
            <kbd className="font-mono">
              {focusedField === "title" ? "\u21A9" : "\u2318\u21A9"}
            </kbd>{" "}
            Create
          </span>
          <span>
            <kbd className="font-mono">Tab</kbd>{" "}
            {focusedField === "title" ? "Notes" : "Title"}
          </span>
          <span>
            <kbd className="font-mono">Esc</kbd> Close
          </span>
          <button
            type="button"
            onClick={handleIdeate}
            disabled={!canIdeate}
            className={`ml-auto flex items-center gap-1.5 px-2 py-0.5 rounded transition-colors ${canIdeate ? "bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 hover:text-purple-300 cursor-pointer" : "text-muted-foreground/20 cursor-default"}`}
          >
            <Brain className="w-3 h-3" />
            <span><kbd className="font-mono">{"\u2318"}I</kbd> Ideate</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function TokenBadge({
  label,
  color,
  onRemove,
}: {
  label: string;
  color: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 pl-1.5 pr-1 py-0.5 rounded-md bg-white/[0.06] text-[11px] text-foreground/70">
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
      <button
        type="button"
        className="text-muted-foreground/40 hover:text-foreground/60 transition-colors"
        onClick={onRemove}
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}
