"use client";

import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useKanbanStore } from "@/lib/store";
import { DocumentFile } from "@/lib/types";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Brain, ChevronRight, File, Pin } from "lucide-react";
import { SIDEBAR_SECTION_COUNT, SIDEBAR_SECTION_LABEL } from "./sidebar-section-label";

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
      className={`w-full text-left py-2 rounded-md text-[13px] transition-colors flex items-center gap-2 ${
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
  const { memoryFiles, openDocument, selectedDocument } = useKanbanStore(
    useShallow((s) => ({ memoryFiles: s.memoryFiles, openDocument: s.openDocument, selectedDocument: s.selectedDocument }))
  );
  const [isOpen, setIsOpen] = useState(false);

  if (memoryFiles.length === 0) return null;

  const pinned = memoryFiles.filter((f) => f.name === "MEMORY.md");
  const rest = memoryFiles.filter((f) => f.name !== "MEMORY.md");

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="px-2 relative z-0">
      <CollapsibleTrigger className={`flex items-center gap-2 w-full px-3 py-1.5 ${SIDEBAR_SECTION_LABEL} hover:text-foreground transition-colors`}>
        <ChevronRight
          className={`h-3 w-3 transition-transform duration-200 ${
            isOpen ? "rotate-90" : ""
          }`}
        />
        <Brain className="h-3 w-3" />
        <span>Memory</span>
        <span className={SIDEBAR_SECTION_COUNT}>
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
