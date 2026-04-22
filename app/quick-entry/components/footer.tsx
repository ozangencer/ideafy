import { Brain } from "lucide-react";
import { FocusedField } from "../types";

interface TriggerHintsProps {
  dim: boolean;
}

export function TriggerHints({ dim }: TriggerHintsProps) {
  return (
    <div
      className={`px-5 py-1.5 border-t border-[hsl(var(--border))] flex items-center gap-3 text-[10px] font-mono transition-colors duration-300 ${
        dim ? "text-muted-foreground/30" : "text-muted-foreground/60"
      }`}
    >
      <span>@ project</span>
      <span>/ status</span>
      <span>[ platform</span>
      <span>c: complexity</span>
      <span>! priority</span>
    </div>
  );
}

interface FooterProps {
  focusedField: FocusedField;
  canSubmit: boolean;
  hasSelectedProject: boolean;
  canIdeate: boolean;
  missingForIdeate: string;
  onIdeate: () => void;
  showTopBorder: boolean;
}

export function Footer(props: FooterProps) {
  const {
    focusedField,
    canSubmit,
    hasSelectedProject,
    canIdeate,
    missingForIdeate,
    onIdeate,
    showTopBorder,
  } = props;

  return (
    <div
      className={`px-5 py-2 ${
        showTopBorder ? "border-t border-[hsl(var(--border))]" : ""
      } flex items-center gap-4 text-[11px] text-muted-foreground/55`}
    >
      <span className={canSubmit ? "text-muted-foreground/80" : ""}>
        <kbd className="px-1 py-[1px] bg-secondary border border-border rounded text-[10px] font-mono">
          {focusedField === "title" ? "↩" : "⌘↩"}
        </kbd>{" "}
        Create
        {!hasSelectedProject && (
          <span className="ml-1 text-muted-foreground/55">(@project)</span>
        )}
      </span>
      <button
        type="button"
        onClick={onIdeate}
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
            {"⌘"}I
          </kbd>
          Ideate
        </span>
        {!canIdeate && missingForIdeate && (
          <span className="text-[10px] text-muted-foreground/55">{missingForIdeate}</span>
        )}
      </button>
      <span className="ml-auto">
        <kbd className="px-1 py-[1px] bg-secondary border border-border rounded text-[10px] font-mono">Tab</kbd>{" "}
        {focusedField === "title" ? "Notes" : "Title"}
      </span>
      <span>
        <kbd className="px-1 py-[1px] bg-secondary border border-border rounded text-[10px] font-mono">Esc</kbd>{" "}
        Close
      </span>
    </div>
  );
}
