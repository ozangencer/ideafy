"use client";

import { useEffect, useState } from "react";
import { Check, ChevronRight, Copy } from "lucide-react";

// The "why did it fail" affordance shared by the Background Processes panel
// and the activity bell. Both sit inside clickable rows that open the card, so
// every handler here stops propagation.

export function RunErrorToggle({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-expanded={expanded}
      className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 shrink-0"
    >
      <ChevronRight className={`w-2.5 h-2.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
      Details
    </button>
  );
}

export function RunErrorDetails({ error }: { error: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(error);
      setCopied(true);
    } catch (err) {
      console.error("Failed to copy run error:", err);
    }
  };

  return (
    // Text selection inside the box must not open the card either.
    <div className="mt-1.5 cursor-auto" onClick={(e) => e.stopPropagation()}>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-ink/15 bg-ink/[0.04] p-2 font-mono text-[11px] leading-snug text-foreground select-text">
        {error}
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        className="mt-1 text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
