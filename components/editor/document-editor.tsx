"use client";

import { useState, useEffect } from "react";
import { useKanbanStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { X, FileText, ExternalLink, FolderOpen, Maximize2, Minimize2 } from "lucide-react";

export function DocumentEditor() {
  const {
    selectedDocument,
    documentContent,
    closeDocumentEditor,
    isDocumentEditorOpen,
  } = useKanbanStore();

  const [isOpening, setIsOpening] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleClose = () => {
    closeDocumentEditor();
  };

  // ESC key handler
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  const handleOpenInEditor = async () => {
    if (!selectedDocument) return;

    setIsOpening(true);
    try {
      await fetch("/api/open-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedDocument.path }),
      });
      // Close the preview after opening in external editor
      handleClose();
    } catch (error) {
      console.error("Failed to open file:", error);
    } finally {
      setIsOpening(false);
    }
  };

  const handleRevealInFinder = async () => {
    if (!selectedDocument) return;

    setIsRevealing(true);
    try {
      await fetch("/api/open-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedDocument.path, action: "reveal" }),
      });
      // Don't close the panel - user may want to continue viewing
    } catch (error) {
      console.error("Failed to reveal file:", error);
    } finally {
      setIsRevealing(false);
    }
  };

  if (!isDocumentEditorOpen || !selectedDocument) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 transition-opacity"
        onClick={handleClose}
      />

      {/* Panel */}
      <div className={`relative bg-card border-l border-border w-full h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300 transition-all ${
          isExpanded ? "max-w-[1200px]" : "max-w-[700px]"
        }`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {selectedDocument.name}
              </h2>
              <p className="text-xs text-muted-foreground">
                {selectedDocument.relativePath}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRevealInFinder}
              disabled={isRevealing}
            >
              <FolderOpen className="h-4 w-4 mr-2" />
              {isRevealing ? "Opening..." : "Show in Finder"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenInEditor}
              disabled={isOpening}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              {isOpening ? "Opening..." : "Open in Editor"}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-8 w-8"
              title={isExpanded ? "Collapse panel" : "Expand panel"}
            >
              {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Preview Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-background">
          <article className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-h1:text-xl prose-h2:text-lg prose-h3:text-base prose-code:bg-zinc-200 dark:prose-code:bg-zinc-800 prose-code:text-zinc-800 dark:prose-code:text-zinc-200 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-zinc-100 dark:prose-pre:bg-zinc-900 prose-pre:text-zinc-800 dark:prose-pre:text-zinc-200 prose-pre:border prose-pre:border-zinc-300 dark:prose-pre:border-zinc-700">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {documentContent}
            </ReactMarkdown>
          </article>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-border shrink-0 bg-muted/30">
          <div className="text-xs text-muted-foreground">
            Press Esc to close
          </div>
          <Button variant="outline" size="sm" onClick={handleClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
