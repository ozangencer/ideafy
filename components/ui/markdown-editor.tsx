"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import ImageResize from "tiptap-extension-resize-image";
import { useEffect, useRef, useMemo, useCallback } from "react";
import { useKanbanStore } from "@/lib/store";
import { SkillMention, McpMention, CardMention, DocumentMention } from "@/lib/mention-extension";
import { createSuggestion, createCardSuggestion, createDocumentSuggestion } from "@/lib/suggestion";
import { getDisplayId } from "@/lib/types";
import tippy, { Instance } from "tippy.js";

// Extend HTMLElement to include tippy instance
declare global {
  interface HTMLElement {
    _tippy?: Instance;
  }
}

interface MarkdownEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
  onCardClick?: (cardId: string) => void;
  projectId?: string | null;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder = "Write here...",
  minHeight = "80px",
  onCardClick,
  projectId,
}: MarkdownEditorProps) {
  const isUpdatingFromExternal = useRef(false);
  const lastSyncedValue = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { skills, mcps, cards, projects, activeProjectId, documents } = useKanbanStore();

  // Ref to hold current documents for the callback
  const documentsRef = useRef<typeof documents>([]);

  // Fetch and maintain documents for the card's project
  useEffect(() => {
    const effectiveProjectId = projectId || activeProjectId;

    if (effectiveProjectId && effectiveProjectId !== activeProjectId) {
      // Card has a project but sidebar shows "All Projects" - fetch card's project documents
      fetch(`/api/projects/${effectiveProjectId}/documents`)
        .then(res => res.json())
        .then(docs => {
          documentsRef.current = Array.isArray(docs) ? docs : [];
        })
        .catch(() => {
          documentsRef.current = [];
        });
    } else {
      // Use store's documents
      documentsRef.current = documents;
    }
  }, [projectId, activeProjectId, documents]);

  // Callback to get current documents (used by suggestion)
  const getDocuments = useCallback(() => documentsRef.current, []);

  const skillSuggestion = useMemo(
    () => createSuggestion({ char: "/", items: skills, prefix: "/", nodeType: "skillMention" }),
    [skills]
  );

  const mcpSuggestion = useMemo(
    () => createSuggestion({ char: "@", items: mcps, prefix: "@", nodeType: "mcpMention" }),
    [mcps]
  );

  const cardSuggestion = useMemo(
    () => createCardSuggestion({ cards, projects, activeProjectId }),
    [cards, projects, activeProjectId]
  );

  const documentSuggestion = useMemo(
    () => createDocumentSuggestion({ getDocuments }),
    [getDocuments]
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: "is-editor-empty",
      }),
      SkillMention.configure({
        suggestion: skillSuggestion,
      }),
      McpMention.configure({
        suggestion: mcpSuggestion,
      }),
      CardMention.configure({
        suggestion: cardSuggestion,
      }),
      DocumentMention.configure({
        suggestion: documentSuggestion,
      }),
      ImageResize.configure({
        inline: false,
        allowBase64: true,
      }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "prose-kanban",
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith("image/")) {
            event.preventDefault();
            const file = item.getAsFile();
            if (!file) continue;

            // Check file size (max 5MB)
            const MAX_SIZE = 5 * 1024 * 1024;
            if (file.size > MAX_SIZE) {
              console.warn("Image too large (max 5MB)");
              return true;
            }

            const reader = new FileReader();
            reader.onload = () => {
              const base64 = reader.result as string;
              const nodeType = view.state.schema.nodes.imageResize || view.state.schema.nodes.image;
              if (nodeType) {
                view.dispatch(
                  view.state.tr.replaceSelectionWith(
                    nodeType.create({ src: base64 })
                  )
                );
              }
            };
            reader.readAsDataURL(file);
            return true;
          }
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      if (isUpdatingFromExternal.current) return;

      const html = editor.getHTML();
      lastSyncedValue.current = html;
      onChange(html);
    },
  });

  // Sync value to editor
  useEffect(() => {
    if (!editor) return;
    if (value === lastSyncedValue.current) return;

    isUpdatingFromExternal.current = true;
    editor.commands.setContent(value || "");
    lastSyncedValue.current = value;
    isUpdatingFromExternal.current = false;
  }, [value, editor]);

  // Setup hover tooltips for card mentions
  useEffect(() => {
    if (!containerRef.current) return;

    // Small delay to ensure DOM is updated after editor renders
    const timeoutId = setTimeout(() => {
      const mentions = containerRef.current?.querySelectorAll(".card-mention");
      if (!mentions) return;

      mentions.forEach((mention) => {
        // Skip if already has tippy
        if ((mention as HTMLElement)._tippy) return;

        const cardId = mention.getAttribute("data-id");
        const card = cards.find((c) => c.id === cardId);
        if (!card) return;

        const project = projects.find((p) => p.id === card.projectId);
        const displayId = getDisplayId(card, project);

        // Strip HTML for description preview
        const descriptionPreview = card.description
          ? card.description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)
          : "";

        const content = document.createElement("div");
        content.className = "card-preview-tooltip";
        content.style.maxWidth = "320px";
        content.innerHTML = `
          <div class="tooltip-title">${displayId ? `<span class="tooltip-id">${displayId}</span>` : ""}${card.title}</div>
          <div class="tooltip-meta">${card.status.replace("progress", "in progress")}${project ? ` · ${project.name}` : ""}</div>
          ${descriptionPreview ? `<div class="tooltip-description">${descriptionPreview}${card.description.length > 120 ? "..." : ""}</div>` : ""}
        `;

        tippy(mention as HTMLElement, {
          content,
          allowHTML: true,
          placement: "top",
          theme: "card-preview",
          delay: [300, 0],
          interactive: false,
        });
      });
    }, 100);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [value, cards, projects]);

  // Handle card mention clicks
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("card-mention") || target.closest(".card-mention")) {
      const mention = target.classList.contains("card-mention") ? target : target.closest(".card-mention") as HTMLElement;
      const cardId = mention?.getAttribute("data-id");
      if (cardId && onCardClick) {
        e.preventDefault();
        e.stopPropagation();
        onCardClick(cardId);
      }
    }
  }, [onCardClick]);

  return (
    <div
      ref={containerRef}
      className="tiptap-editor"
      style={{ minHeight }}
      onClick={handleContainerClick}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
