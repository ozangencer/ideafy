"use client";

import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import { COLUMNS, Complexity, Priority, Status, AiPlatform } from "@/lib/types";
import { X, Brain } from "lucide-react";
import { PlatformIcon } from "@/components/icons/platform-icons";
import { QuickEntryEditor, QuickEntryEditorRef } from "@/components/quick-entry/quick-entry-editor";

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

// Complexity options for c: autocomplete
const COMPLEXITY_OPTIONS = [
  { key: "low" as Complexity, label: "Low", color: "#22c55e", trigger: "c:low" },
  { key: "medium" as Complexity, label: "Medium", color: "#facc15", trigger: "c:medium" },
  { key: "high" as Complexity, label: "High", color: "#f87171", trigger: "c:high" },
];

const PLATFORM_MAP: Record<string, AiPlatform> = {
  "ai:claude": "claude",
  "ai:gemini": "gemini",
  "ai:codex": "codex",
};

const PLATFORM_LABELS: Record<AiPlatform, { label: string; color: string }> = {
  claude: { label: "Claude", color: "#cc785c" },
  gemini: { label: "Gemini", color: "#4285f4" },
  codex: { label: "Codex", color: "#10a37f" },
};

// Platform options for [ autocomplete
const PLATFORM_OPTIONS = [
  { key: "claude" as AiPlatform, label: "Claude Code", color: "#cc785c", bracket: "[claude" },
  { key: "gemini" as AiPlatform, label: "Gemini CLI", color: "#4285f4", bracket: "[gemini" },
  { key: "codex" as AiPlatform, label: "Codex CLI", color: "#10a37f", bracket: "[codex" },
];

type AutocompleteType = "project" | "status" | "platform" | "complexity" | null;

// Remove trigger text and ensure trailing space for cursor breathing room
const stripTrigger = (text: string, pattern: RegExp, replacement = ""): string => {
  const result = text.replace(pattern, replacement).trimStart();
  return result ? result.trimEnd() + " " : "";
};

export default function QuickEntryPage() {
  const [title, setTitle] = useState("");
  const [descHasContent, setDescHasContent] = useState(false);
  const [priority, setPriority] = useState<Priority>("medium");
  const [status, setStatus] = useState<Status>("ideation");
  const [statusExplicit, setStatusExplicit] = useState(false);
  const [complexity, setComplexity] = useState<Complexity>("medium");
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [aiPlatform, setAiPlatform] = useState<AiPlatform | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectError, setProjectError] = useState(false);

  // Unified autocomplete state
  const [acType, setAcType] = useState<AutocompleteType>(null);
  const [acQuery, setAcQuery] = useState("");
  const [acIndex, setAcIndex] = useState(0);
  const [acSource, setAcSource] = useState<"title" | "description">("title");

  const [focusedField, setFocusedField] = useState<"title" | "description">(
    "title"
  );

  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<QuickEntryEditorRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const projectsRef = useRef<Project[]>([]);
  const priorityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const descPlainTextRef = useRef("");
  const acTriggerLengthRef = useRef(0);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data: Project[]) => {
        setProjects(data);
        projectsRef.current = data;
        const lastId = localStorage.getItem("quickEntryLastProjectId");
        if (lastId) {
          const match = data.find((p) => p.id === lastId);
          if (match) setSelectedProject(match);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => titleRef.current?.focus());
  }, []);

  // Cleanup priority debounce on unmount
  useEffect(() => {
    return () => {
      if (priorityTimeoutRef.current) clearTimeout(priorityTimeoutRef.current);
    };
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
      if (priorityTimeoutRef.current) {
        clearTimeout(priorityTimeoutRef.current);
        priorityTimeoutRef.current = null;
      }
      setTitle("");
      descRef.current?.clear();
      setDescHasContent(false);
      descPlainTextRef.current = "";
      setPriority("medium");
      setStatus("ideation");
      setStatusExplicit(false);
      setComplexity("medium");
      setAiPlatform(null);
      setProjectError(false);
      setAcType(null);
      setAcQuery("");
      setAcIndex(0);
      setFocusedField("title");
      // Re-fetch projects to pick up any color/name changes
      fetch("/api/projects")
        .then((r) => r.json())
        .then((data: Project[]) => {
          setProjects(data);
          projectsRef.current = data;
          const lastId = localStorage.getItem("quickEntryLastProjectId");
          const match = lastId ? data.find((p) => p.id === lastId) : null;
          setSelectedProject(match ?? null);
        })
        .catch(() => {
          // Fallback to cached data
          const lastId = localStorage.getItem("quickEntryLastProjectId");
          const match = lastId ? projectsRef.current.find((p) => p.id === lastId) : null;
          setSelectedProject(match ?? null);
        });
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
    if (acType === "platform") {
      const q = acQuery.toLowerCase();
      if (!q) return PLATFORM_OPTIONS;
      return PLATFORM_OPTIONS.filter(
        (p) =>
          p.label.toLowerCase().includes(q) ||
          p.key.includes(q)
      );
    }
    if (acType === "complexity") {
      const q = acQuery.toLowerCase();
      if (!q) return COMPLEXITY_OPTIONS;
      return COMPLEXITY_OPTIONS.filter(
        (c) =>
          c.label.toLowerCase().includes(q) ||
          c.key.includes(q)
      );
    }
    return [];
  }, [acType, acQuery, projects]);

  const showAutocomplete = acType !== null && acItems.length > 0;

  // Check for @, /, [ triggers in a value
  const detectTrigger = useCallback(
    (value: string, source: "title" | "description") => {
      // Check @ trigger (project)
      const atMatch = value.match(/@([\w\-.]*)$/);
      if (atMatch) {
        setAcType("project");
        setAcQuery(atMatch[1]);
        setAcIndex(0);
        setAcSource(source);
        acTriggerLengthRef.current = atMatch[0].length; // @query
        return true;
      }

      // Check / trigger (status) - only at start of input or after space, directly followed by word chars
      // Must not match "word / word" patterns (slash surrounded by spaces)
      const slashMatch = value.match(/(?:^|(?<=\s))\/([\w]+)$|(?:^|\s)\/$/);
      if (slashMatch) {
        const query = slashMatch[1] || "";
        setAcType("status");
        setAcQuery(query);
        setAcIndex(0);
        setAcSource(source);
        acTriggerLengthRef.current = 1 + query.length; // /query
        return true;
      }

      // Check c: trigger (complexity)
      const complexityMatch = value.match(/(?:^|\s)c:([\w]*)$/);
      if (complexityMatch) {
        setAcType("complexity");
        setAcQuery(complexityMatch[1]);
        setAcIndex(0);
        setAcSource(source);
        acTriggerLengthRef.current = 2 + complexityMatch[1].length; // c:query
        return true;
      }

      // Check [ trigger (AI platform)
      const bracketMatch = value.match(/\[([\w]*)$/);
      if (bracketMatch) {
        setAcType("platform");
        setAcQuery(bracketMatch[1]);
        setAcIndex(0);
        setAcSource(source);
        acTriggerLengthRef.current = bracketMatch[0].length; // [query
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

      // Clear any pending priority debounce
      if (priorityTimeoutRef.current) {
        clearTimeout(priorityTimeoutRef.current);
        priorityTimeoutRef.current = null;
      }

      // Consume !! → high priority (immediate when followed by space)
      if (/(?:^|\s)!!\s/.test(processed)) {
        setPriority("high");
        processed = stripTrigger(processed, /(?:^|\s)!!\s/, " ");
      }
      // Consume ! → low priority (immediate when followed by space, excluding !!)
      else if (/(?:^|\s)!(?!!)\s/.test(processed)) {
        setPriority("low");
        processed = stripTrigger(processed, /(?:^|\s)!(?!!)\s/, " ");
      }
      // Debounced: !! at end of string → wait then set high
      else if (/(?:^|\s)!!$/.test(processed)) {
        priorityTimeoutRef.current = setTimeout(() => {
          setPriority("high");
          setTitle((prev) => stripTrigger(prev, /(?:^|\s)!!$/));
          priorityTimeoutRef.current = null;
        }, 500);
      }
      // Debounced: ! at end of string → wait then set low (gives time for !!)
      else if (/(?:^|\s)!$/.test(processed)) {
        priorityTimeoutRef.current = setTimeout(() => {
          setPriority("low");
          setTitle((prev) => stripTrigger(prev, /(?:^|\s)!$/));
          priorityTimeoutRef.current = null;
        }, 500);
      }

      // Consume ai:platform tokens
      for (const [token, platformValue] of Object.entries(PLATFORM_MAP)) {
        const regex = new RegExp(
          `(?:^|\\s)${token.replace(":", "\\:")}(?:\\s|$)`
        );
        if (regex.test(processed)) {
          setAiPlatform(platformValue);
          processed = stripTrigger(processed, regex, " ");
          break;
        }
      }

      setTitle(processed);
    },
    [detectTrigger]
  );

  const handleDescriptionTextChange = useCallback(
    (plainText: string) => {
      descPlainTextRef.current = plainText;
      setDescHasContent(!!plainText.trim());
      detectTrigger(plainText, "description");
    },
    [detectTrigger]
  );

  const handleSelectProject = useCallback(
    (project: Project) => {
      setSelectedProject(project);
      setProjectError(false);
      if (acSource === "title") {
        setTitle((prev) => stripTrigger(prev, /@[\w\-.]*$/));
        titleRef.current?.focus();
      } else {
        descRef.current?.deleteBackwards(acTriggerLengthRef.current);
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
      setStatusExplicit(true);
      // Remove /query from the source field
      if (acSource === "title") {
        setTitle((prev) => stripTrigger(prev, /(?:^|\s)\/[\w]*$/));
        titleRef.current?.focus();
      } else {
        descRef.current?.deleteBackwards(acTriggerLengthRef.current);
        descRef.current?.focus();
      }
      setAcType(null);
      setAcIndex(0);
    },
    [acSource]
  );

  const handleSelectPlatform = useCallback(
    (platformOption: (typeof PLATFORM_OPTIONS)[0]) => {
      setAiPlatform(platformOption.key);
      // Remove [query from the source field
      if (acSource === "title") {
        setTitle((prev) => stripTrigger(prev, /\[[\w]*$/));
        titleRef.current?.focus();
      } else {
        descRef.current?.deleteBackwards(acTriggerLengthRef.current);
        descRef.current?.focus();
      }
      setAcType(null);
      setAcIndex(0);
    },
    [acSource]
  );

  const handleSelectComplexity = useCallback(
    (complexityOption: (typeof COMPLEXITY_OPTIONS)[0]) => {
      setComplexity(complexityOption.key);
      // Remove c:query from the source field
      if (acSource === "title") {
        setTitle((prev) => stripTrigger(prev, /(?:^|\s)c:[\w]*$/));
        titleRef.current?.focus();
      } else {
        descRef.current?.deleteBackwards(acTriggerLengthRef.current);
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
      } else if (acType === "platform") {
        handleSelectPlatform(item as (typeof PLATFORM_OPTIONS)[0]);
      } else if (acType === "complexity") {
        handleSelectComplexity(item as (typeof COMPLEXITY_OPTIONS)[0]);
      }
    },
    [acType, acItems, handleSelectProject, handleSelectStatus, handleSelectPlatform, handleSelectComplexity]
  );

  const dismissAutocomplete = useCallback(() => {
    if (acSource === "title") {
      const removePattern =
        acType === "project" ? /@[\w\-.]*$/ :
        acType === "platform" ? /\[[\w]*$/ :
        acType === "complexity" ? /(?:^|\s)c:[\w]*$/ :
        /(?:^|\s)\/[\w]*$/;
      setTitle((prev) => stripTrigger(prev, removePattern));
    } else {
      descRef.current?.deleteBackwards(acTriggerLengthRef.current);
    }
    setAcType(null);
  }, [acType, acSource]);

  const canSubmit = !!(title.trim() && selectedProject && status);
  const canIdeate = !!(title.trim() && descHasContent && selectedProject);

  const handleIdeate = useCallback(async () => {
    if (!canIdeate) return;

    try {
      const response = await fetch("/api/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: descRef.current?.getHTML() ?? "",
          solutionSummary: "",
          testScenarios: "",
          aiOpinion: "",
          aiVerdict: null,
          status: "ideation" as Status,
          complexity,
          priority,
          aiPlatform,
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
      const createdCard = await response.json();
      if (createdCard?.id) {
        fetch(`/api/cards/${createdCard.id}/evaluate`, { method: "POST" });
      }
      if (selectedProject) {
        localStorage.setItem("quickEntryLastProjectId", selectedProject.id);
      }
    } catch {
      // Silently fail - card creation failed
    }

    closeWindow();
  }, [canIdeate, title, complexity, priority, aiPlatform, selectedProject, closeWindow]);

  const handleSubmit = useCallback(async () => {
    if (!title.trim()) return;

    if (!selectedProject) {
      setProjectError(true);
      return;
    }

    if (!status) return;

    try {
      await fetch("/api/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: descRef.current?.getHTML() ?? "",
          solutionSummary: "",
          testScenarios: "",
          aiOpinion: "",
          aiVerdict: null,
          status,
          complexity,
          priority,
          aiPlatform,
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
      if (selectedProject) {
        localStorage.setItem("quickEntryLastProjectId", selectedProject.id);
      }
    } catch {
      // Silently fail
    }

    closeWindow();
  }, [
    title,
    status,
    complexity,
    priority,
    aiPlatform,
    selectedProject,
    closeWindow,
  ]);

  // Shared keydown handler for autocomplete navigation
  // Accepts both React.KeyboardEvent and native KeyboardEvent
  const handleAcKeyDown = useCallback(
    (e: { key: string; preventDefault: () => void }): boolean => {
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

      if (e.key === "i" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleIdeate();
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
      handleIdeate,
    ]
  );

  // Tiptap handleKeyDown receives native KeyboardEvent, returns boolean
  const handleEditorKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (acType !== null) {
          dismissAutocomplete();
        } else {
          closeWindow();
        }
        return true;
      }

      // Cmd+I → Ideate (takes priority over Tiptap's italic)
      if (event.key === "i" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        handleIdeate();
        return true;
      }

      // Cmd+Enter always submits, even during autocomplete
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        handleSubmit();
        return true;
      }

      if (handleAcKeyDown(event)) return true;

      if (event.key === "Tab" && event.shiftKey) {
        event.preventDefault();
        setFocusedField("title");
        requestAnimationFrame(() => titleRef.current?.focus());
        return true;
      }

      // Let Tiptap handle everything else (Cmd+B, lists, etc.)
      return false;
    },
    [closeWindow, acType, dismissAutocomplete, handleAcKeyDown, handleSubmit, handleIdeate]
  );

  const statusLabel = COLUMNS.find((c) => c.id === status)?.title;
  const hasBadges =
    !!selectedProject ||
    priority !== "medium" ||
    statusExplicit ||
    complexity !== "medium" ||
    !!aiPlatform;
  const missingForIdeate = !title.trim()
    ? "(title)"
    : !descHasContent
    ? "(notes)"
    : !selectedProject
    ? "(@project)"
    : "";

  return (
    <div className="h-screen w-screen bg-transparent flex items-start justify-center">
      <div ref={containerRef} className="w-full rounded-2xl overflow-hidden bg-[hsl(var(--popover))] border border-[hsl(var(--border))] shadow-[var(--shadow-popover)]">
        {/* Drag handle */}
        <div className="h-4 w-full cursor-grab active:cursor-grabbing" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <div className="mx-auto mt-1.5 w-8 h-1 rounded-full bg-[hsl(var(--foreground)/0.15)]" />
        </div>
        {/* Title */}
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          onKeyDown={handleTitleKeyDown}
          onFocus={() => setFocusedField("title")}
          placeholder="New card"
          className="block w-full bg-transparent border-0 px-5 pt-1 pb-2 text-[17px] font-medium tracking-tight leading-tight text-foreground placeholder:text-muted-foreground/50 outline-none ring-0 focus:ring-0"
          autoComplete="off"
          spellCheck={false}
        />

        {/* Description */}
        <div
          className="relative px-5 pb-3 pt-0"
          onFocus={() => setFocusedField("description")}
        >
          {focusedField === "description" && (
            <span className="pointer-events-none absolute left-0 top-0 bottom-3 w-[2px] rounded-r-full bg-[hsl(var(--primary)/0.5)]" />
          )}
          <QuickEntryEditor
            ref={descRef}
            placeholder="Notes"
            onTextChange={handleDescriptionTextChange}
            onKeyDown={handleEditorKeyDown}
          />
        </div>

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
                label={priority === "high" ? "P: High" : "P: Low"}
                color={priority === "high" ? "#f87171" : "#9ca3af"}
                onRemove={() => setPriority("medium")}
              />
            )}
            {statusExplicit && (
              <TokenBadge
                label={statusLabel ?? status}
                color={STATUS_COLORS[status]}
                onRemove={() => {
                  setStatus("ideation");
                  setStatusExplicit(false);
                }}
              />
            )}
            {complexity !== "medium" && (
              <TokenBadge
                label={complexity === "high" ? "C: High" : "C: Low"}
                color={complexity === "high" ? "#f87171" : "#22c55e"}
                onRemove={() => setComplexity("medium")}
              />
            )}
            {aiPlatform && (
              <TokenBadge
                label={PLATFORM_LABELS[aiPlatform].label}
                color={PLATFORM_LABELS[aiPlatform].color}
                onRemove={() => setAiPlatform(null)}
              />
            )}
          </div>
        )}

        {/* Project required error */}
        {projectError && (
          <div className="mx-5 mb-2 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/20 text-[12px] text-red-500">
            Project is required. Type <kbd className="font-mono bg-red-500/30 px-1.5 py-0.5 rounded text-red-600">@</kbd> to select a project.
          </div>
        )}

        {/* Autocomplete dropdown */}
        {showAutocomplete && (
          <div className="border-t border-[hsl(var(--border))]">
            {acType === "project" &&
              (acItems as Project[]).map((project, idx) => (
                <button
                  key={project.id}
                  className={`relative w-full px-5 py-2 flex items-center gap-2.5 text-[13px] text-left transition-colors ${
                    idx === acIndex
                      ? "bg-[hsl(var(--foreground)/0.06)]"
                      : "hover:bg-[hsl(var(--foreground)/0.03)]"
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelectProject(project);
                  }}
                  onMouseEnter={() => setAcIndex(idx)}
                >
                  {idx === acIndex && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-[hsl(var(--primary))]" />
                  )}
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: project.color }}
                  />
                  <span className={idx === acIndex ? "text-foreground" : "text-foreground/70"}>
                    {project.name}
                  </span>
                  <span className="text-muted-foreground/55 text-xs ml-auto font-mono">
                    {project.idPrefix}
                  </span>
                </button>
              ))}
            {acType === "status" &&
              (acItems as (typeof STATUS_OPTIONS)[number][]).map(
                (option, idx) => (
                  <button
                    key={option.key}
                    className={`relative w-full px-5 py-2 flex items-center gap-2.5 text-[13px] text-left transition-colors ${
                      idx === acIndex
                        ? "bg-[hsl(var(--foreground)/0.06)]"
                        : "hover:bg-[hsl(var(--foreground)/0.03)]"
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectStatus(option);
                    }}
                    onMouseEnter={() => setAcIndex(idx)}
                  >
                    {idx === acIndex && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-[hsl(var(--primary))]" />
                    )}
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: option.color }}
                    />
                    <span className={idx === acIndex ? "text-foreground" : "text-foreground/70"}>
                      {option.label}
                    </span>
                    <span className="text-muted-foreground/55 text-xs ml-auto font-mono">
                      {option.slash}
                    </span>
                  </button>
                )
              )}
            {acType === "platform" &&
              (acItems as (typeof PLATFORM_OPTIONS)[number][]).map(
                (option, idx) => (
                  <button
                    key={option.key}
                    className={`relative w-full px-5 py-2 flex items-center gap-2.5 text-[13px] text-left transition-colors ${
                      idx === acIndex
                        ? "bg-[hsl(var(--foreground)/0.06)]"
                        : "hover:bg-[hsl(var(--foreground)/0.03)]"
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectPlatform(option);
                    }}
                    onMouseEnter={() => setAcIndex(idx)}
                  >
                    {idx === acIndex && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-[hsl(var(--primary))]" />
                    )}
                    <PlatformIcon platform={option.key} size={14} className="shrink-0" />
                    <span className={idx === acIndex ? "text-foreground" : "text-foreground/70"}>
                      {option.label}
                    </span>
                    <span className="text-muted-foreground/55 text-xs ml-auto font-mono">
                      {option.bracket}
                    </span>
                  </button>
                )
              )}
            {acType === "complexity" &&
              (acItems as (typeof COMPLEXITY_OPTIONS)[number][]).map(
                (option, idx) => (
                  <button
                    key={option.key}
                    className={`relative w-full px-5 py-2 flex items-center gap-2.5 text-[13px] text-left transition-colors ${
                      idx === acIndex
                        ? "bg-[hsl(var(--foreground)/0.06)]"
                        : "hover:bg-[hsl(var(--foreground)/0.03)]"
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectComplexity(option);
                    }}
                    onMouseEnter={() => setAcIndex(idx)}
                  >
                    {idx === acIndex && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-[hsl(var(--primary))]" />
                    )}
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: option.color }}
                    />
                    <span className={idx === acIndex ? "text-foreground" : "text-foreground/70"}>
                      {option.label}
                    </span>
                    <span className="text-muted-foreground/55 text-xs ml-auto font-mono">
                      {option.trigger}
                    </span>
                  </button>
                )
              )}
          </div>
        )}

        {/* Trigger hints - hidden when autocomplete is open */}
        {!showAutocomplete && (
          <div
            className={`px-5 py-1.5 border-t border-[hsl(var(--border))] flex items-center gap-3 text-[10px] font-mono transition-colors duration-300 ${
              title.trim() || descHasContent
                ? "text-muted-foreground/60"
                : "text-muted-foreground/30"
            }`}
          >
            <span>@ project</span>
            <span>/ status</span>
            <span>[ platform</span>
            <span>c: complexity</span>
            <span>! priority</span>
          </div>
        )}

        {/* Footer */}
        <div
          className={`px-5 py-2 ${
            showAutocomplete ? "border-t border-[hsl(var(--border))]" : ""
          } flex items-center gap-4 text-[11px] text-muted-foreground/55`}
        >
          <span className={canSubmit ? "text-muted-foreground/80" : ""}>
            <kbd className="px-1 py-[1px] bg-secondary border border-border rounded text-[10px] font-mono">
              {focusedField === "title" ? "\u21A9" : "\u2318\u21A9"}
            </kbd>{" "}
            Create
            {!selectedProject && (
              <span className="ml-1 text-muted-foreground/55">
                (@project)
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={handleIdeate}
            disabled={!canIdeate}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded transition-all ${
              canIdeate
                ? "bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.2)] active:translate-y-[0.5px] cursor-pointer"
                : "text-muted-foreground/40 cursor-default"
            }`}
          >
            <Brain className="w-3 h-3" />
            <span className="flex items-center gap-1">
              <kbd
                className={`px-1 py-[1px] border rounded text-[10px] font-mono ${
                  canIdeate
                    ? "bg-[hsl(var(--primary)/0.15)] border-[hsl(var(--primary)/0.3)]"
                    : "bg-secondary border-border"
                }`}
              >
                {"\u2318"}I
              </kbd>
              Ideate
            </span>
            {!canIdeate && missingForIdeate && (
              <span className="text-[10px] text-muted-foreground/55">
                {missingForIdeate}
              </span>
            )}
          </button>
          <span className="ml-auto">
            <kbd className="px-1 py-[1px] bg-secondary border border-border rounded text-[10px] font-mono">
              Tab
            </kbd>{" "}
            {focusedField === "title" ? "Notes" : "Title"}
          </span>
          <span>
            <kbd className="px-1 py-[1px] bg-secondary border border-border rounded text-[10px] font-mono">
              Esc
            </kbd>{" "}
            Close
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
    <span className="inline-flex items-center gap-1.5 pl-2 pr-1.5 py-0.5 rounded-md bg-[hsl(var(--foreground)/0.06)] text-[11px] text-foreground/80">
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
      <button
        type="button"
        className="p-0.5 -m-0.5 text-muted-foreground/50 hover:text-foreground/70 transition-colors"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}
