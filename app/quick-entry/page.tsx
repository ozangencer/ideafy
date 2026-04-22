"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Complexity, Priority, Status, AiPlatform } from "@/lib/types";
import {
  QuickEntryEditor,
  QuickEntryEditorRef,
} from "@/components/quick-entry/quick-entry-editor";
import {
  COMPLEXITY_OPTIONS,
  ComplexityOption,
  PLATFORM_INLINE_MAP,
  PLATFORM_OPTIONS,
  PlatformOption,
  STATUS_OPTIONS,
  StatusOption,
} from "./constants";
import {
  detectTrigger,
  STRIP_PATTERNS,
  stripTrigger,
} from "./triggers";
import {
  AutocompleteKind,
  FocusedField,
  Project,
} from "./types";
import { BadgesBar } from "./components/badges-bar";
import {
  AutocompleteItem,
  AutocompleteList,
} from "./components/autocomplete-list";
import { Footer, TriggerHints } from "./components/footer";
import { useElectronWindow } from "./hooks/use-electron-window";
import { useProjects } from "./hooks/use-projects";

interface AutocompleteState {
  kind: AutocompleteKind;
  query: string;
  source: FocusedField;
  index: number;
  /** Visible length of the trigger text in the source field (for Tiptap deleteBackwards). */
  triggerLength: number;
}

// Build the POST body shared by Create and Ideate. Ideate always forces status
// to "ideation" regardless of what the user typed in /... the side-effect of
// dispatching the evaluate job is handled by the caller.
function buildCardPayload(args: {
  title: string;
  descriptionHtml: string;
  status: Status;
  complexity: Complexity;
  priority: Priority;
  aiPlatform: AiPlatform | null;
  project: Project;
}) {
  const { title, descriptionHtml, status, complexity, priority, aiPlatform, project } = args;
  return {
    title: title.trim(),
    description: descriptionHtml,
    solutionSummary: "",
    testScenarios: "",
    aiOpinion: "",
    aiVerdict: null,
    status,
    complexity,
    priority,
    aiPlatform,
    projectFolder: project.folderPath,
    projectId: project.id,
    gitBranchName: null,
    gitBranchStatus: null,
    gitWorktreePath: null,
    gitWorktreeStatus: null,
    devServerPort: null,
    devServerPid: null,
    rebaseConflict: null,
    conflictFiles: null,
    processingType: null,
  };
}

export default function QuickEntryPage() {
  // Form state
  const [title, setTitle] = useState("");
  const [descHasContent, setDescHasContent] = useState(false);
  const [priority, setPriority] = useState<Priority>("medium");
  const [status, setStatus] = useState<Status>("ideation");
  const [statusExplicit, setStatusExplicit] = useState(false);
  const [complexity, setComplexity] = useState<Complexity>("medium");
  const [aiPlatform, setAiPlatform] = useState<AiPlatform | null>(null);
  const [projectError, setProjectError] = useState(false);
  const [focusedField, setFocusedField] = useState<FocusedField>("title");

  // Unified autocomplete state (null when inactive)
  const [autocomplete, setAutocomplete] = useState<AutocompleteState | null>(null);

  // Refs
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<QuickEntryEditorRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const priorityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const descPlainTextRef = useRef("");

  const { projects, selectedProject, setSelectedProject, refreshAndRestore, rememberSelection } =
    useProjects();
  const { closeWindow } = useElectronWindow(containerRef);

  // Initial focus on the title input
  useEffect(() => {
    requestAnimationFrame(() => titleRef.current?.focus());
  }, []);

  // Clear pending priority debounce on unmount
  useEffect(() => {
    return () => {
      if (priorityTimeoutRef.current) clearTimeout(priorityTimeoutRef.current);
    };
  }, []);

  // Reset flow: clear every field and re-focus title. Fired by the Electron
  // shell when the quick-entry window is reopened so stale text doesn't leak
  // between sessions.
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
      setAutocomplete(null);
      setFocusedField("title");
      refreshAndRestore();
      requestAnimationFrame(() => titleRef.current?.focus());
    };

    window.addEventListener("reset-quick-entry", handleReset);
    return () => window.removeEventListener("reset-quick-entry", handleReset);
  }, [refreshAndRestore]);

  // Run the trigger detector against a field value; setting autocomplete state or clearing it.
  const runDetect = useCallback((value: string, source: FocusedField): boolean => {
    const detected = detectTrigger(value);
    if (detected) {
      setAutocomplete({
        kind: detected.kind,
        query: detected.query,
        source,
        index: 0,
        triggerLength: detected.triggerLength,
      });
      return true;
    }
    setAutocomplete(null);
    return false;
  }, []);

  // Filtered autocomplete items
  const acItems = useMemo<AutocompleteItem[]>(() => {
    if (!autocomplete) return [];
    const q = autocomplete.query.toLowerCase();
    if (autocomplete.kind === "project") {
      return q
        ? projects.filter(
            (p) =>
              p.name.toLowerCase().includes(q) ||
              p.idPrefix.toLowerCase().includes(q),
          )
        : projects;
    }
    if (autocomplete.kind === "status") {
      return q
        ? STATUS_OPTIONS.filter(
            (s) =>
              s.label.toLowerCase().includes(q) ||
              s.key.includes(q) ||
              s.slash.toLowerCase().includes(`/${q}`),
          )
        : STATUS_OPTIONS;
    }
    if (autocomplete.kind === "platform") {
      return q
        ? PLATFORM_OPTIONS.filter(
            (p) => p.label.toLowerCase().includes(q) || p.key.includes(q),
          )
        : PLATFORM_OPTIONS;
    }
    return q
      ? COMPLEXITY_OPTIONS.filter(
          (c) => c.label.toLowerCase().includes(q) || c.key.includes(q),
        )
      : COMPLEXITY_OPTIONS;
  }, [autocomplete, projects]);

  const showAutocomplete = autocomplete !== null && acItems.length > 0;

  // --- Trigger consumption in title (priority !, !!, and inline ai:platform) ----------------

  const handleTitleChange = useCallback(
    (value: string) => {
      let processed = value;

      // Autocomplete triggers take precedence — let them pass through untouched.
      if (runDetect(processed, "title")) {
        setTitle(processed);
        return;
      }

      if (priorityTimeoutRef.current) {
        clearTimeout(priorityTimeoutRef.current);
        priorityTimeoutRef.current = null;
      }

      // !! → high (immediate when followed by space)
      if (/(?:^|\s)!!\s/.test(processed)) {
        setPriority("high");
        processed = stripTrigger(processed, /(?:^|\s)!!\s/, " ");
      }
      // ! → low (immediate when followed by space, excluding !!)
      else if (/(?:^|\s)!(?!!)\s/.test(processed)) {
        setPriority("low");
        processed = stripTrigger(processed, /(?:^|\s)!(?!!)\s/, " ");
      }
      // !! at end → debounce so the second ! registers before commit
      else if (/(?:^|\s)!!$/.test(processed)) {
        priorityTimeoutRef.current = setTimeout(() => {
          setPriority("high");
          setTitle((prev) => stripTrigger(prev, /(?:^|\s)!!$/));
          priorityTimeoutRef.current = null;
        }, 500);
      }
      // ! at end → debounce (gives time for a second !)
      else if (/(?:^|\s)!$/.test(processed)) {
        priorityTimeoutRef.current = setTimeout(() => {
          setPriority("low");
          setTitle((prev) => stripTrigger(prev, /(?:^|\s)!$/));
          priorityTimeoutRef.current = null;
        }, 500);
      }

      // Inline ai:<name> tokens (no autocomplete — direct consumption)
      for (const [token, platformValue] of Object.entries(PLATFORM_INLINE_MAP)) {
        const regex = new RegExp(
          `(?:^|\\s)${token.replace(":", "\\:")}(?:\\s|$)`,
        );
        if (regex.test(processed)) {
          setAiPlatform(platformValue);
          processed = stripTrigger(processed, regex, " ");
          break;
        }
      }

      setTitle(processed);
    },
    [runDetect],
  );

  const handleDescriptionTextChange = useCallback(
    (plainText: string) => {
      descPlainTextRef.current = plainText;
      setDescHasContent(!!plainText.trim());
      runDetect(plainText, "description");
    },
    [runDetect],
  );

  // --- Autocomplete selection / dismissal --------------------------------------------------

  const consumeTriggerFromSource = useCallback(
    (ac: AutocompleteState) => {
      const pattern = STRIP_PATTERNS[ac.kind];
      if (ac.source === "title") {
        setTitle((prev) => stripTrigger(prev, pattern));
        titleRef.current?.focus();
      } else {
        descRef.current?.deleteBackwards(ac.triggerLength);
        descRef.current?.focus();
      }
    },
    [],
  );

  const handleAcSelect = useCallback(
    (index: number) => {
      if (!autocomplete) return;
      const item = acItems[index];
      if (!item) return;

      if (autocomplete.kind === "project") {
        setSelectedProject(item as Project);
        setProjectError(false);
      } else if (autocomplete.kind === "status") {
        setStatus((item as StatusOption).key);
        setStatusExplicit(true);
      } else if (autocomplete.kind === "platform") {
        setAiPlatform((item as PlatformOption).key);
      } else if (autocomplete.kind === "complexity") {
        setComplexity((item as ComplexityOption).key);
      }

      consumeTriggerFromSource(autocomplete);
      setAutocomplete(null);
    },
    [autocomplete, acItems, setSelectedProject, consumeTriggerFromSource],
  );

  const dismissAutocomplete = useCallback(() => {
    if (!autocomplete) return;
    consumeTriggerFromSource(autocomplete);
    setAutocomplete(null);
  }, [autocomplete, consumeTriggerFromSource]);

  // --- Submit / ideate ----------------------------------------------------------------------

  const canSubmit = !!(title.trim() && selectedProject && status);
  const canIdeate = !!(title.trim() && descHasContent && selectedProject);

  const handleIdeate = useCallback(async () => {
    if (!canIdeate || !selectedProject) return;

    try {
      const response = await fetch("/api/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildCardPayload({
            title,
            descriptionHtml: descRef.current?.getHTML() ?? "",
            status: "ideation",
            complexity,
            priority,
            aiPlatform,
            project: selectedProject,
          }),
        ),
      });
      const createdCard = await response.json();
      if (createdCard?.id) {
        fetch(`/api/cards/${createdCard.id}/evaluate`, { method: "POST" });
      }
      rememberSelection(selectedProject);
    } catch {
      // Silently fail — card creation failure just leaves the window closed.
    }

    closeWindow();
  }, [canIdeate, title, complexity, priority, aiPlatform, selectedProject, closeWindow, rememberSelection]);

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
        body: JSON.stringify(
          buildCardPayload({
            title,
            descriptionHtml: descRef.current?.getHTML() ?? "",
            status,
            complexity,
            priority,
            aiPlatform,
            project: selectedProject,
          }),
        ),
      });
      rememberSelection(selectedProject);
    } catch {
      // Silently fail.
    }

    closeWindow();
  }, [title, status, complexity, priority, aiPlatform, selectedProject, closeWindow, rememberSelection]);

  // --- Keyboard handling --------------------------------------------------------------------

  const handleAcKeyDown = useCallback(
    (e: { key: string; preventDefault: () => void }): boolean => {
      if (!showAutocomplete || !autocomplete) return false;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAutocomplete((ac) =>
          ac ? { ...ac, index: ac.index < acItems.length - 1 ? ac.index + 1 : 0 } : ac,
        );
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAutocomplete((ac) =>
          ac ? { ...ac, index: ac.index > 0 ? ac.index - 1 : acItems.length - 1 } : ac,
        );
        return true;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        handleAcSelect(autocomplete.index);
        return true;
      }
      return false;
    },
    [showAutocomplete, autocomplete, acItems.length, handleAcSelect],
  );

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (autocomplete) {
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
    [closeWindow, autocomplete, dismissAutocomplete, handleAcKeyDown, showAutocomplete, handleSubmit, handleIdeate],
  );

  // Tiptap handleKeyDown receives the native KeyboardEvent and expects a boolean return.
  const handleEditorKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (autocomplete) {
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
    [closeWindow, autocomplete, dismissAutocomplete, handleAcKeyDown, handleSubmit, handleIdeate],
  );

  const missingForIdeate = !title.trim()
    ? "(title)"
    : !descHasContent
    ? "(notes)"
    : !selectedProject
    ? "(@project)"
    : "";

  return (
    <div className="h-screen w-screen bg-transparent flex items-start justify-center">
      <div
        ref={containerRef}
        className="w-full rounded-2xl overflow-hidden bg-[hsl(var(--popover))] border border-[hsl(var(--border))] shadow-[var(--shadow-popover)]"
      >
        {/* Drag handle */}
        <div
          className="h-4 w-full cursor-grab active:cursor-grabbing"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
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

        <BadgesBar
          selectedProject={selectedProject}
          onClearProject={() => setSelectedProject(null)}
          priority={priority}
          onClearPriority={() => setPriority("medium")}
          status={status}
          statusExplicit={statusExplicit}
          onClearStatus={() => {
            setStatus("ideation");
            setStatusExplicit(false);
          }}
          complexity={complexity}
          onClearComplexity={() => setComplexity("medium")}
          aiPlatform={aiPlatform}
          onClearPlatform={() => setAiPlatform(null)}
        />

        {projectError && (
          <div className="mx-5 mb-2 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/20 text-[12px] text-red-500">
            Project is required. Type{" "}
            <kbd className="font-mono bg-red-500/30 px-1.5 py-0.5 rounded text-red-600">@</kbd>{" "}
            to select a project.
          </div>
        )}

        {showAutocomplete && autocomplete && (
          <AutocompleteList
            kind={autocomplete.kind}
            items={acItems}
            activeIndex={autocomplete.index}
            onHover={(i) =>
              setAutocomplete((ac) => (ac ? { ...ac, index: i } : ac))
            }
            onSelect={handleAcSelect}
          />
        )}

        {!showAutocomplete && (
          <TriggerHints dim={!(title.trim() || descHasContent)} />
        )}

        <Footer
          focusedField={focusedField}
          canSubmit={canSubmit}
          hasSelectedProject={!!selectedProject}
          canIdeate={canIdeate}
          missingForIdeate={missingForIdeate}
          onIdeate={handleIdeate}
          showTopBorder={showAutocomplete}
        />
      </div>
    </div>
  );
}
