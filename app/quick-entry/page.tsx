"use client";

import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import { COLUMNS, Complexity, Priority, Status } from "@/lib/types";
import { X } from "lucide-react";

interface Project {
  id: string;
  name: string;
  idPrefix: string;
  color: string;
  folderPath: string;
}

const STATUS_COLORS: Record<Status, string> = {
  ideation: "#8b5cf6",
  backlog: "#6b7280",
  bugs: "#ef4444",
  progress: "#facc15",
  test: "#3b82f6",
  completed: "#22c55e",
  withdrawn: "#6b7280",
};

// Status options for / autocomplete
const STATUS_OPTIONS = COLUMNS.map((c) => ({
  key: c.id as Status,
  label: c.title,
  color: STATUS_COLORS[c.id as Status],
  slash: `/${c.id === "ideation" ? "idea" : c.id === "bugs" ? "bug" : c.id}`,
}));

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

type AutocompleteType = "project" | "status" | null;

export default function QuickEntryPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [status, setStatus] = useState<Status>("backlog");
  const [complexity, setComplexity] = useState<Complexity>("medium");
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);

  // Unified autocomplete state
  const [acType, setAcType] = useState<AutocompleteType>(null);
  const [acQuery, setAcQuery] = useState("");
  const [acIndex, setAcIndex] = useState(0);
  const [acSource, setAcSource] = useState<"title" | "description">("title");

  const [focusedField, setFocusedField] = useState<"title" | "description">(
    "title"
  );

  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => setProjects(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => titleRef.current?.focus());
  }, []);

  // Force transparent background for Electron quick entry window
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  // Auto-resize Electron window to match content
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const api = (window as any).electronAPI;
    if (!api?.resizeWindow) return;

    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight;
      if (h > 0) api.resizeWindow(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const closeWindow = useCallback(() => {
    if ((window as any).electronAPI?.closeQuickEntryWindow) {
      (window as any).electronAPI.closeQuickEntryWindow();
    }
  }, []);

  useEffect(() => {
    const handleReset = () => {
      setTitle("");
      setDescription("");
      setPriority("medium");
      setStatus("backlog");
      setComplexity("medium");
      setSelectedProject(null);
      setAcType(null);
      setAcQuery("");
      setAcIndex(0);
      setFocusedField("title");
      requestAnimationFrame(() => titleRef.current?.focus());
    };

    window.addEventListener("reset-quick-entry", handleReset);
    return () => window.removeEventListener("reset-quick-entry", handleReset);
  }, []);

  // Filtered autocomplete items
  const acItems = useMemo(() => {
    if (acType === "project") {
      const q = acQuery.toLowerCase();
      if (!q) return projects;
      return projects.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.idPrefix.toLowerCase().includes(q)
      );
    }
    if (acType === "status") {
      const q = acQuery.toLowerCase();
      if (!q) return STATUS_OPTIONS;
      return STATUS_OPTIONS.filter(
        (s) =>
          s.label.toLowerCase().includes(q) ||
          s.key.includes(q) ||
          s.slash.toLowerCase().includes(`/${q}`)
      );
    }
    return [];
  }, [acType, acQuery, projects]);

  const showAutocomplete = acType !== null && acItems.length > 0;

  // Check for @ or / triggers in a value
  const detectTrigger = useCallback(
    (value: string, source: "title" | "description") => {
      // Check @ trigger (project)
      const atMatch = value.match(/@([\w\-.]*)$/);
      if (atMatch) {
        setAcType("project");
        setAcQuery(atMatch[1]);
        setAcIndex(0);
        setAcSource(source);
        return true;
      }

      // Check / trigger (status) - only at start of input or after space, directly followed by word chars
      // Must not match "word / word" patterns (slash surrounded by spaces)
      const slashMatch = value.match(/(?:^|(?<=\s))\/([\w]+)$|(?:^|\s)\/$/);
      if (slashMatch) {
        // If it's just "/" at the end (no chars after), show all statuses
        // If it's "/word", filter by the word
        const query = slashMatch[1] || "";
        setAcType("status");
        setAcQuery(query);
        setAcIndex(0);
        setAcSource(source);
        return true;
      }

      setAcType(null);
      return false;
    },
    []
  );

  const handleTitleChange = useCallback(
    (value: string) => {
      let processed = value;

      // Check for autocomplete triggers first
      if (detectTrigger(processed, "title")) {
        setTitle(processed);
        return;
      }

      // Consume !! → high priority
      if (/(?:^|\s)!!(?:\s|$)/.test(processed)) {
        setPriority("high");
        processed = processed.replace(/(?:^|\s)!!(?:\s|$)/, " ").trim();
      }

      // Consume ! → low priority
      if (/(?:^|\s)!(?:\s|$)/.test(processed)) {
        setPriority("low");
        processed = processed.replace(/(?:^|\s)!(?:\s|$)/, " ").trim();
      }

      // Consume c:complexity tokens
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
    },
    [detectTrigger]
  );

  const handleDescriptionChange = useCallback(
    (value: string) => {
      detectTrigger(value, "description");
      setDescription(value);
    },
    [detectTrigger]
  );

  const handleSelectProject = useCallback(
    (project: Project) => {
      setSelectedProject(project);
      // Remove @query from the source field
      if (acSource === "title") {
        setTitle((prev) => prev.replace(/@[\w\-.]*$/, "").trim());
        titleRef.current?.focus();
      } else {
        setDescription((prev) => prev.replace(/@[\w\-.]*$/, "").trim());
        descRef.current?.focus();
      }
      setAcType(null);
      setAcIndex(0);
    },
    [acSource]
  );

  const handleSelectStatus = useCallback(
    (statusOption: (typeof STATUS_OPTIONS)[0]) => {
      setStatus(statusOption.key);
      // Remove /query from the source field
      if (acSource === "title") {
        setTitle((prev) => prev.replace(/(?:^|\s)\/[\w]*$/, "").trim());
        titleRef.current?.focus();
      } else {
        setDescription((prev) => prev.replace(/(?:^|\s)\/[\w]*$/, "").trim());
        descRef.current?.focus();
      }
      setAcType(null);
      setAcIndex(0);
    },
    [acSource]
  );

  const handleAcSelect = useCallback(
    (index: number) => {
      const item = acItems[index];
      if (!item) return;
      if (acType === "project") {
        handleSelectProject(item as Project);
      } else if (acType === "status") {
        handleSelectStatus(item as (typeof STATUS_OPTIONS)[0]);
      }
    },
    [acType, acItems, handleSelectProject, handleSelectStatus]
  );

  const dismissAutocomplete = useCallback(() => {
    const removePattern = acType === "project" ? /@[\w\-.]*$/ : /(?:^|\s)\/[\w]*$/;
    if (acSource === "title") {
      setTitle((prev) => prev.replace(removePattern, "").trim());
    } else {
      setDescription((prev) => prev.replace(removePattern, "").trim());
    }
    setAcType(null);
  }, [acType, acSource]);

  const handleSubmit = useCallback(async () => {
    if (!title.trim()) return;

    try {
      await fetch("/api/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          solutionSummary: "",
          testScenarios: "",
          aiOpinion: "",
          aiVerdict: null,
          status,
          complexity,
          priority,
          projectFolder: selectedProject?.folderPath ?? "",
          projectId: selectedProject?.id ?? null,
          gitBranchName: null,
          gitBranchStatus: null,
          gitWorktreePath: null,
          gitWorktreeStatus: null,
          devServerPort: null,
          devServerPid: null,
          rebaseConflict: null,
          conflictFiles: null,
          processingType: null,
        }),
      });
    } catch {
      // Silently fail
    }

    closeWindow();
  }, [
    title,
    description,
    status,
    complexity,
    priority,
    selectedProject,
    closeWindow,
  ]);

  // Shared keydown handler for autocomplete navigation
  const handleAcKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!showAutocomplete) return false;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAcIndex((i) => (i < acItems.length - 1 ? i + 1 : 0));
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAcIndex((i) => (i > 0 ? i - 1 : acItems.length - 1));
        return true;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        handleAcSelect(acIndex);
        return true;
      }
      return false;
    },
    [showAutocomplete, acItems.length, acIndex, handleAcSelect]
  );

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (acType !== null) {
          dismissAutocomplete();
        } else {
          closeWindow();
        }
        return;
      }

      if (handleAcKeyDown(e)) return;

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

      // Cmd+Enter always submits
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [
      closeWindow,
      acType,
      dismissAutocomplete,
      handleAcKeyDown,
      showAutocomplete,
      handleSubmit,
    ]
  );

  const handleDescKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (acType !== null) {
          dismissAutocomplete();
        } else {
          closeWindow();
        }
        return;
      }

      // Cmd+Enter always submits, even during autocomplete
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
        return;
      }

      if (handleAcKeyDown(e)) return;

      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        setFocusedField("title");
        requestAnimationFrame(() => titleRef.current?.focus());
        return;
      }
    },
    [closeWindow, acType, dismissAutocomplete, handleAcKeyDown, handleSubmit]
  );

  const statusLabel = COLUMNS.find((c) => c.id === status)?.title;
  const hasBadges =
    selectedProject ||
    priority !== "medium" ||
    status !== "backlog" ||
    complexity !== "medium";

  return (
    <div className="h-screen w-screen bg-transparent flex items-start justify-center">
      <div ref={containerRef} className="w-full rounded-lg overflow-hidden bg-[hsl(var(--popover))] border border-white/[0.08] shadow-[0_16px_70px_-12px_rgba(0,0,0,0.8)]">
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
          onChange={(e) => handleDescriptionChange(e.target.value)}
          onKeyDown={handleDescKeyDown}
          onFocus={() => setFocusedField("description")}
          placeholder="Notes"
          rows={1}
          className="block w-full bg-transparent border-0 px-5 pb-3 pt-0 text-[13px] text-muted-foreground placeholder:text-muted-foreground/30 outline-none ring-0 focus:ring-0 resize-none leading-relaxed"
        />

        {/* Badges */}
        {hasBadges && (
          <div className="px-5 pb-3 flex flex-wrap gap-1.5">
            {selectedProject && (
              <TokenBadge
                label={selectedProject.name}
                color={selectedProject.color}
                onRemove={() => setSelectedProject(null)}
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

        {/* Autocomplete dropdown */}
        {showAutocomplete && (
          <div className="border-t border-white/[0.06]">
            {acType === "project" &&
              (acItems as Project[]).map((project, idx) => (
                <button
                  key={project.id}
                  className={`w-full px-5 py-2 flex items-center gap-2.5 text-[13px] text-left transition-colors ${
                    idx === acIndex
                      ? "bg-white/[0.08]"
                      : "hover:bg-white/[0.04]"
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelectProject(project);
                  }}
                  onMouseEnter={() => setAcIndex(idx)}
                >
                  {idx === acIndex && (
                    <span className="text-foreground/60 text-xs">{">"}</span>
                  )}
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: project.color }}
                  />
                  <span className={idx === acIndex ? "text-foreground" : "text-foreground/70"}>
                    {project.name}
                  </span>
                  <span className="text-muted-foreground/30 text-xs ml-auto font-mono">
                    {project.idPrefix}
                  </span>
                </button>
              ))}
            {acType === "status" &&
              (acItems as (typeof STATUS_OPTIONS)[number][]).map(
                (option, idx) => (
                  <button
                    key={option.key}
                    className={`w-full px-5 py-2 flex items-center gap-2.5 text-[13px] text-left transition-colors ${
                      idx === acIndex
                        ? "bg-white/[0.08]"
                        : "hover:bg-white/[0.04]"
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectStatus(option);
                    }}
                    onMouseEnter={() => setAcIndex(idx)}
                  >
                    {idx === acIndex && (
                      <span className="text-foreground/60 text-xs">{">"}</span>
                    )}
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: option.color }}
                    />
                    <span className={idx === acIndex ? "text-foreground" : "text-foreground/70"}>
                      {option.label}
                    </span>
                    <span className="text-muted-foreground/30 text-xs ml-auto font-mono">
                      {option.slash}
                    </span>
                  </button>
                )
              )}
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
