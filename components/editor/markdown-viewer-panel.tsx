"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  X,
  FileText,
  ExternalLink,
  FolderOpen,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type MarkdownViewerPanelProps = {
  title: string;
  subtitle: string;
  content: string;
  path: string;
  onClose: () => void;
};

export function MarkdownViewerPanel({
  title,
  subtitle,
  content,
  path,
  onClose,
}: MarkdownViewerPanelProps) {
  const [isOpening, setIsOpening] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const handleOpen = async () => {
    setIsOpening(true);
    try {
      await fetch("/api/open-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      onClose();
    } catch (error) {
      console.error("Failed to open file:", error);
    } finally {
      setIsOpening(false);
    }
  };

  const handleReveal = async () => {
    setIsRevealing(true);
    try {
      await fetch("/api/open-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, action: "reveal" }),
      });
    } catch (error) {
      console.error("Failed to reveal file:", error);
    } finally {
      setIsRevealing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/40 transition-opacity"
        onClick={onClose}
      />

      <div
        className={`relative flex h-full w-full flex-col border-l border-border bg-card shadow-2xl transition-all animate-in slide-in-from-right duration-300 ${
          isExpanded ? "max-w-[1200px]" : "max-w-[700px]"
        }`}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <div className="min-w-0 flex items-center gap-3">
            <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-foreground">
                {title}
              </h2>
              <p className="truncate text-xs text-muted-foreground">
                {subtitle}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReveal}
              disabled={isRevealing}
            >
              <FolderOpen className="mr-2 h-4 w-4" />
              {isRevealing ? "Opening..." : "Show in Finder"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpen}
              disabled={isOpening}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              {isOpening ? "Opening..." : "Open in Editor"}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-8 w-8"
              title={isExpanded ? "Collapse panel" : "Expand panel"}
            >
              {isExpanded ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-background p-6">
          <article className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-h1:text-xl prose-h2:text-lg prose-h3:text-base prose-code:bg-zinc-200 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-zinc-800 prose-code:before:content-none prose-code:after:content-none prose-pre:bg-zinc-100 prose-pre:text-zinc-800 prose-pre:border prose-pre:border-zinc-300 dark:prose-code:bg-zinc-800 dark:prose-code:text-zinc-200 dark:prose-pre:bg-zinc-900 dark:prose-pre:text-zinc-200 dark:prose-pre:border-zinc-700">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </article>
        </div>

        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-6 py-3 shrink-0">
          <div className="truncate pr-4 text-xs text-muted-foreground">
            {path}
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
