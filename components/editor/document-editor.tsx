"use client";

import { useKanbanStore } from "@/lib/store";
import { MarkdownViewerPanel } from "./markdown-viewer-panel";

export function DocumentEditor() {
  const {
    selectedDocument,
    documentContent,
    closeDocumentEditor,
    isDocumentEditorOpen,
  } = useKanbanStore();

  if (!isDocumentEditorOpen || !selectedDocument) return null;

  return (
    <MarkdownViewerPanel
      title={selectedDocument.name}
      subtitle={selectedDocument.relativePath}
      content={documentContent}
      path={selectedDocument.path}
      onClose={closeDocumentEditor}
    />
  );
}
