"use client";

import { useState } from "react";
import { useKanbanStore } from "@/lib/store";
import { DocumentFile } from "@/lib/types";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Brain, ChevronRight, File, Pin } from "lucide-react";

function MemoryFileItem({
  file,
  isPinned,
  selectedDocument,
  openDocument,
}: {
  file: DocumentFile;
  isPinned: boolean;
  selectedDocument: DocumentFile | null;
  openDocument: (doc: DocumentFile) => Promise<void>;
}) {
  const isSelected = selectedDocument?.path === file.path;

  return (
    <button
      onClick={() => openDocument(file)}
      className={`w-full text-left py-2 rounded-md text-sm transition-colors flex items-center gap-2 ${
        isSelected
          ? "bg-paper-cream text-ink font-medium border-l-2 border-ink"
          : isPinned
            ? "text-foreground hover:bg-muted"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
      style={{ paddingLeft: "12px", paddingRight: "12px" }}
    >
      {isPinned ? (
        <Pin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      ) : (
        <File className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className={`break-all ${isPinned ? "font-medium" : ""}`}>
        {file.name}
      </span>
    </button>
  );
}

export function MemoryList() {
  const { memoryFiles, openDocument, selectedDocument } = useKanbanStore();
  const [isOpen, setIsOpen] = useState(false);

  if (memoryFiles.length === 0) return null;

  const pinned = memoryFiles.filter((f) => f.name === "MEMORY.md");
  const rest = memoryFiles.filter((f) => f.name !== "MEMORY.md");

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="px-2 relative z-0">
      <CollapsibleTrigger className="flex items-center gap-2 w-full px-2 py-2 text-xs text-muted-foreground uppercase tracking-wider font-medium hover:text-foreground transition-colors">
        <ChevronRight
          className={`h-3 w-3 transition-transform duration-200 ${
            isOpen ? "rotate-90" : ""
          }`}
        />
        <Brain className="h-3.5 w-3.5" />
        <span>Memory</span>
        <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded normal-case">
          {memoryFiles.length}
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-1 space-y-0.5">
        {pinned.map((file) => (
          <MemoryFileItem
            key={file.path}
            file={file}
            isPinned
            selectedDocument={selectedDocument}
            openDocument={openDocument}
          />
        ))}
        {pinned.length > 0 && rest.length > 0 && (
          <div className="my-1 border-t border-border/50" />
        )}
        {rest.map((file) => (
          <MemoryFileItem
            key={file.path}
            file={file}
            isPinned={false}
            selectedDocument={selectedDocument}
            openDocument={openDocument}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
