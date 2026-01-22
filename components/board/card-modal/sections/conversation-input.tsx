"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import ImageResize from "tiptap-extension-resize-image";
import { useCallback, useRef, useMemo, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Send, Square } from "lucide-react";
import { useKanbanStore } from "@/lib/store";
import { UnifiedMention, CardMention, DocumentMention } from "@/lib/mention-extension";
import { createUnifiedSuggestion, createCardSuggestion, createDocumentSuggestion } from "@/lib/suggestion";
import { MentionData, SectionType } from "@/lib/types";
import { commonEditorProps } from "@/lib/editor-config";

interface ConversationInputProps {
  cardId: string;
  sectionType: SectionType;
  projectId: string | null;
  isLoading: boolean;
  onSend: (content: string, mentions: MentionData[]) => void;
  onCancel?: () => void;
  placeholder?: string;
}

// Check if any suggestion popup is currently visible
function isSuggestionPopupOpen(): boolean {
  // TipTap suggestions use tippy popups with data-tippy-root attribute
  const tippyRoots = Array.from(document.querySelectorAll("[data-tippy-root]"));
  for (let i = 0; i < tippyRoots.length; i++) {
    const root = tippyRoots[i];
    // Check if the tippy is visible (not hidden)
    const box = root.querySelector(".tippy-box");
    if (box && (!box.hasAttribute("data-state") || box.getAttribute("data-state") === "visible")) {
      return true;
    }
  }
  return false;
}

export function ConversationInput({
  cardId,
  sectionType,
  projectId,
  isLoading,
  onSend,
  onCancel,
  placeholder = "Type a message...",
}: ConversationInputProps) {
  const { cards, projects, activeProjectId, documents, skills, mcps } = useKanbanStore();
  const documentsRef = useRef<typeof documents>([]);
  const [isEmpty, setIsEmpty] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [localProjectSkills, setLocalProjectSkills] = useState<string[]>([]);
  const [localProjectMcps, setLocalProjectMcps] = useState<string[]>([]);

  // Fetch and maintain documents for the card's project
  useEffect(() => {
    const effectiveProjectId = projectId || activeProjectId;

    if (effectiveProjectId && effectiveProjectId !== activeProjectId) {
      fetch(`/api/projects/${effectiveProjectId}/documents`)
        .then((res) => res.json())
        .then((docs) => {
          documentsRef.current = Array.isArray(docs) ? docs : [];
        })
        .catch(() => {
          documentsRef.current = [];
        });
    } else {
      documentsRef.current = documents;
    }
  }, [projectId, activeProjectId, documents]);

  const getDocuments = useCallback(() => documentsRef.current, []);

  // Fetch project-specific skills/mcps based on card's project
  useEffect(() => {
    const effectiveProjectId = projectId || activeProjectId;

    if (!effectiveProjectId) {
      setLocalProjectSkills([]);
      setLocalProjectMcps([]);
      return;
    }

    // Fetch project's skills and mcps
    Promise.all([
      fetch(`/api/projects/${effectiveProjectId}/skills/list`).then(r => r.json()).catch(() => ({ skills: [] })),
      fetch(`/api/projects/${effectiveProjectId}/mcps/list`).then(r => r.json()).catch(() => ({ mcps: [] })),
    ]).then(([skillsData, mcpsData]) => {
      setLocalProjectSkills(skillsData.skills || []);
      setLocalProjectMcps(mcpsData.mcps || []);
    });
  }, [projectId, activeProjectId]);

  // Create unified items getter that merges global + card's project items
  const getUnifiedItems = useCallback(() => {
    const items: Array<{ id: string; label: string; type: "skill" | "mcp" | "plugin" }> = [];
    const addedIds = new Set<string>();

    // Merge global + project skills
    const allSkills = Array.from(new Set([...skills, ...localProjectSkills]));
    allSkills.forEach((skill) => {
      if (!addedIds.has(`skill-${skill}`)) {
        addedIds.add(`skill-${skill}`);
        items.push({ id: skill, label: skill, type: "skill" });
      }
    });

    // Merge global + project MCPs
    const allMcps = Array.from(new Set([...mcps, ...localProjectMcps]));
    allMcps.forEach((mcp) => {
      if (!addedIds.has(`mcp-${mcp}`)) {
        addedIds.add(`mcp-${mcp}`);
        items.push({ id: mcp, label: mcp, type: "mcp" });
      }
    });

    return items;
  }, [skills, mcps, localProjectSkills, localProjectMcps]);

  // Unified suggestion for / trigger (skills, MCPs, plugins)
  const unifiedSuggestion = useMemo(
    () => createUnifiedSuggestion({ getItems: getUnifiedItems }),
    [getUnifiedItems]
  );

  const cardSuggestion = useMemo(
    () => createCardSuggestion({ cards, projects, activeProjectId }),
    [cards, projects, activeProjectId]
  );

  const documentSuggestion = useMemo(
    () => createDocumentSuggestion({ getDocuments }),
    [getDocuments]
  );

  // Extract mentions helper
  const extractMentions = useCallback((json: Record<string, unknown>): MentionData[] => {
    const mentions: MentionData[] = [];
    type NodeType = { type?: string; attrs?: Record<string, unknown>; content?: NodeType[] };

    const traverse = (node: NodeType) => {
      if (node.type === "unifiedMention" && node.attrs) {
        // Unified mention - extract type from itemType attribute
        const itemType = node.attrs.itemType as "skill" | "mcp" | "plugin";
        mentions.push({ type: itemType, id: node.attrs.id as string, label: node.attrs.label as string });
      } else if (node.type === "skillMention" && node.attrs) {
        // Legacy skill mention
        mentions.push({ type: "skill", id: node.attrs.id as string, label: node.attrs.label as string });
      } else if (node.type === "mcpMention" && node.attrs) {
        // Legacy mcp mention
        mentions.push({ type: "mcp", id: node.attrs.id as string, label: node.attrs.label as string });
      } else if (node.type === "cardMention" && node.attrs) {
        mentions.push({ type: "card", id: node.attrs.id as string, label: node.attrs.label as string });
      } else if (node.type === "documentMention" && node.attrs) {
        mentions.push({ type: "document", id: node.attrs.id as string, label: node.attrs.label as string });
      }
      if (node.content && Array.isArray(node.content)) {
        node.content.forEach(traverse);
      }
    };
    traverse(json as NodeType);
    return mentions;
  }, []);

  // Check if editor has content (text or images)
  const checkHasContent = useCallback((editor: ReturnType<typeof useEditor>) => {
    if (!editor) return false;
    const json = editor.getJSON();

    // Check for text content
    const text = editor.getText().trim();
    if (text) return true;

    // Check for images in the content
    const hasImages = JSON.stringify(json).includes('"type":"imageResize"') ||
                      JSON.stringify(json).includes('"type":"image"');
    return hasImages;
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: "is-editor-empty",
      }),
      ImageResize.configure({
        inline: false,
        allowBase64: true,
      }),
      UnifiedMention.configure({
        suggestion: unifiedSuggestion,
      }),
      CardMention.configure({
        suggestion: cardSuggestion,
      }),
      DocumentMention.configure({
        suggestion: documentSuggestion,
      }),
    ],
    editorProps: {
      attributes: {
        class: "prose-kanban chat-input-editor",
      },
      // Handle image paste
      handlePaste: commonEditorProps.handlePaste,
      // Handle Enter key here - this runs AFTER suggestion handlers
      handleKeyDown: (view, event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          // Check if suggestion popup is open - if so, let it handle the key
          if (isSuggestionPopupOpen()) {
            return false; // Let TipTap/suggestion handle it
          }

          // No suggestion open - send the message
          event.preventDefault();

          if (editor && !isLoading && checkHasContent(editor)) {
            const json = editor.getJSON();
            const hasImages = JSON.stringify(json).includes('"type":"imageResize"') ||
                              JSON.stringify(json).includes('"type":"image"');
            const content = hasImages ? editor.getHTML() : view.state.doc.textContent.trim();
            const mentions = extractMentions(json);
            onSend(content, mentions);
            editor.commands.clearContent();
          }
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      setIsEmpty(!checkHasContent(ed));
    },
  });

  // Handle send via button click
  const handleSend = useCallback(() => {
    if (!editor || isLoading) return;
    if (!checkHasContent(editor)) return;

    // Get HTML content (includes images) or plain text
    const json = editor.getJSON();
    const hasImages = JSON.stringify(json).includes('"type":"imageResize"') ||
                      JSON.stringify(json).includes('"type":"image"');

    const content = hasImages ? editor.getHTML() : editor.getText().trim();
    const mentions = extractMentions(json);
    onSend(content, mentions);
    editor.commands.clearContent();
  }, [editor, isLoading, onSend, extractMentions, checkHasContent]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    onCancel?.();
  }, [onCancel]);

  return (
    <div className="flex items-end gap-2">
      <div
        ref={containerRef}
        className="flex-1 chat-input-container rounded-lg border border-border/50 bg-background/50 focus-within:border-accent/50 transition-colors"
      >
        <EditorContent editor={editor} />
      </div>
      {isLoading ? (
        <Button
          size="icon"
          variant="destructive"
          onClick={handleCancel}
          className="h-9 w-9 shrink-0"
          title="Stop generation"
        >
          <Square className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          size="icon"
          onClick={handleSend}
          disabled={isEmpty}
          className="h-9 w-9 shrink-0"
        >
          <Send className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
