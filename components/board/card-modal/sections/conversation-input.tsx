"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import ImageResize from "tiptap-extension-resize-image";
import { useCallback, useRef, useMemo, useEffect, useState, useLayoutEffect } from "react";
import { Button } from "@/components/ui/button";
import { Send, Square, X } from "lucide-react";
import { useKanbanStore } from "@/lib/store";
import { UnifiedMention, CardMention, DocumentMention } from "@/lib/mention-extension";
import { createUnifiedSuggestion, createCardSuggestion, createDocumentSuggestion } from "@/lib/suggestion";
import { ImageAttachment } from "@/lib/image-attachment-extension";
import { MentionData, SectionType } from "@/lib/types";

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
  const { cards, projects, activeProjectId, documents, skills, mcps, agents } = useKanbanStore();
  const documentsRef = useRef<typeof documents>([]);
  const [isEmpty, setIsEmpty] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [localProjectSkills, setLocalProjectSkills] = useState<string[]>([]);
  const [localProjectMcps, setLocalProjectMcps] = useState<string[]>([]);
  const [localProjectAgents, setLocalProjectAgents] = useState<string[]>([]);

  // Pasted image attachments shown as chips above the editor. Kept outside the
  // TipTap doc so the input height stays stable. At send time, they are serialized
  // into the HTML content as <img src="data:..."> tags so the backend
  // extractConversationImages() regex picks them up and writes temp files — the
  // existing contract to the CLI is unchanged.
  //
  // Each chip is paired with an inline `imageAttachment` node in the editor doc
  // that displays `📎 image N`. The `id` links both sides for two-way binding
  // (chip × removes the node; backspacing the node removes the chip via onUpdate).
  // `index` is a monotonic counter that only resets on send.
  type PastedImage = { id: string; base64: string; mime: string; index: number };
  const [pastedImages, setPastedImages] = useState<PastedImage[]>([]);
  const pastedImagesRef = useRef<PastedImage[]>([]);
  const indexCounterRef = useRef(0);

  // Refs to avoid recreating editorProps on every render
  const isLoadingRef = useRef(isLoading);
  const onSendRef = useRef(onSend);

  // Keep refs in sync with props
  useLayoutEffect(() => {
    isLoadingRef.current = isLoading;
    onSendRef.current = onSend;
    pastedImagesRef.current = pastedImages;
  }, [isLoading, onSend, pastedImages]);

  // editorRef lets removePastedImage reach the current editor without forcing
  // the callback identity to change on every editor re-render.
  const editorRef = useRef<ReturnType<typeof useEditor> | null>(null);

  const removePastedImage = useCallback((id: string) => {
    setPastedImages((prev) => prev.filter((img) => img.id !== id));
    const ed = editorRef.current;
    if (!ed) return;
    const positions: Array<{ from: number; to: number }> = [];
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name === "imageAttachment" && node.attrs.id === id) {
        positions.push({ from: pos, to: pos + node.nodeSize });
      }
    });
    // Reverse so earlier positions don't shift later ones during deletion.
    positions.reverse().forEach(({ from, to }) => {
      ed.chain().focus().deleteRange({ from, to }).run();
    });
  }, []);

  // Build the content string in the same shape the backend expects:
  // - plain text when there are no images
  // - HTML with embedded <img src="data:..."> when images are attached
  const buildContent = useCallback((ed: ReturnType<typeof useEditor>) => {
    if (!ed) return "";
    const chips = pastedImagesRef.current;
    const json = ed.getJSON();
    const editorHasImg =
      JSON.stringify(json).includes('"type":"imageResize"') ||
      JSON.stringify(json).includes('"type":"image"');
    const anyImages = chips.length > 0 || editorHasImg;
    if (!anyImages) {
      return ed.getText({ blockSeparator: "\n" }).trim();
    }
    const chipsHtml = chips
      .map((img) => `<p><img src="${img.base64}" alt="" /></p>`)
      .join("");
    return chipsHtml + ed.getHTML();
  }, []);

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
      setLocalProjectAgents([]);
      return;
    }

    // Fetch project's skills, mcps and agents
    Promise.all([
      fetch(`/api/projects/${effectiveProjectId}/skills/list`).then(r => r.json()).catch(() => ({ skills: [] })),
      fetch(`/api/projects/${effectiveProjectId}/mcps/list`).then(r => r.json()).catch(() => ({ mcps: [] })),
      fetch(`/api/projects/${effectiveProjectId}/agents/list`).then(r => r.json()).catch(() => ({ agents: [] })),
    ]).then(([skillsData, mcpsData, agentsData]) => {
      setLocalProjectSkills(skillsData.skills || []);
      setLocalProjectMcps(mcpsData.mcps || []);
      setLocalProjectAgents(agentsData.agents || []);
    });
  }, [projectId, activeProjectId]);

  // Create unified items getter that merges global + card's project items
  const getUnifiedItems = useCallback(() => {
    const items: Array<{ id: string; label: string; type: "skill" | "mcp" | "agent" | "plugin" }> = [];
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

    // Merge global + project agents
    const allAgents = Array.from(new Set([...agents, ...localProjectAgents]));
    allAgents.forEach((agent) => {
      if (!addedIds.has(`agent-${agent}`)) {
        addedIds.add(`agent-${agent}`);
        items.push({ id: agent, label: agent, type: "agent" });
      }
    });

    return items;
  }, [skills, mcps, agents, localProjectSkills, localProjectMcps, localProjectAgents]);

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
        const itemType = node.attrs.itemType as "skill" | "mcp" | "agent" | "plugin";
        mentions.push({ type: itemType, id: node.attrs.id as string, label: node.attrs.label as string });
      } else if (node.type === "skillMention" && node.attrs) {
        // Legacy skill mention
        mentions.push({ type: "skill", id: node.attrs.id as string, label: node.attrs.label as string });
      } else if (node.type === "mcpMention" && node.attrs) {
        // Legacy mcp mention
        mentions.push({ type: "mcp", id: node.attrs.id as string, label: node.attrs.label as string });
      } else if (node.type === "cardMention" && node.attrs) {
        const displayId = (node.attrs.displayId as string) || "";
        const title = (node.attrs.title as string) || "";
        const cardLabel = displayId && title ? `${displayId} · ${title}` : (displayId || title || "Card");
        mentions.push({ type: "card", id: node.attrs.id as string, label: cardLabel });
      } else if (node.type === "documentMention" && node.attrs) {
        const docLabel = (node.attrs.name || node.attrs.label || "Document") as string;
        mentions.push({ type: "document", id: node.attrs.id as string, label: docLabel });
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

  // Memoize extensions to prevent editor recreation on re-renders
  const extensions = useMemo(() => [
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
    ImageAttachment,
  ], [placeholder, unifiedSuggestion, cardSuggestion, documentSuggestion]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    editorProps: {
      attributes: {
        class: "prose-kanban chat-input-editor",
      },
      // Intercept image paste — push into chips state instead of inserting
      // an inline node so the editor height stays stable. An `imageAttachment`
      // node ("📎 image N") is inserted at the caret so the user sees where in
      // the message the image was attached and can reference it by number.
      // Backend `extractConversationImages` only matches base64 <img> tags,
      // so the span markers are passed through as decorative text.
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith("image/")) {
            event.preventDefault();
            const file = item.getAsFile();
            if (!file) continue;
            const MAX_SIZE = 5 * 1024 * 1024;
            if (file.size > MAX_SIZE) {
              console.warn("Image too large (max 5MB)");
              return true;
            }
            const reader = new FileReader();
            reader.onload = () => {
              const base64 = reader.result as string;
              const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              const index = ++indexCounterRef.current;
              setPastedImages((prev) => [
                ...prev,
                { id, base64, mime: item.type, index },
              ]);
              const nodeType = view.state.schema.nodes.imageAttachment;
              if (nodeType) {
                view.dispatch(
                  view.state.tr
                    .replaceSelectionWith(nodeType.create({ id, index }))
                    .scrollIntoView()
                );
              }
            };
            reader.readAsDataURL(file);
            return true;
          }
        }
        return false;
      },
      // Handle Enter key here - this runs AFTER suggestion handlers
      // Using refs to avoid recreating this function on every render
      handleKeyDown: (view, event) => {
        if (event.key === "Enter" && event.shiftKey) {
          event.preventDefault();
          if (editor) {
            editor.chain().focus().setHardBreak().scrollIntoView().run();
          }
          return true;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          // Check if suggestion popup is open - if so, let it handle the key
          if (isSuggestionPopupOpen()) {
            return false; // Let TipTap/suggestion handle it
          }

          // No suggestion open - send the message
          event.preventDefault();

          // Use refs to get current values without causing re-renders
          const hasChips = pastedImagesRef.current.length > 0;
          if (editor && !isLoadingRef.current && (checkHasContent(editor) || hasChips)) {
            const json = editor.getJSON();
            const content = buildContent(editor);
            const mentions = extractMentions(json);
            onSendRef.current(content, mentions);
            editor.commands.clearContent();
            setPastedImages([]);
            indexCounterRef.current = 0;
          }
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      setIsEmpty(!checkHasContent(ed));
      // Sync doc → state: if the user backspaced an attachment marker out of
      // the editor, drop the matching chip from state.
      const aliveIds = new Set<string>();
      ed.state.doc.descendants((node) => {
        if (node.type.name === "imageAttachment") {
          aliveIds.add(node.attrs.id as string);
        }
      });
      setPastedImages((prev) => {
        const filtered = prev.filter((img) => aliveIds.has(img.id));
        return filtered.length === prev.length ? prev : filtered;
      });
    },
  });

  // Keep editorRef in sync for callbacks that need the latest instance.
  useLayoutEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Handle send via button click
  const handleSend = useCallback(() => {
    if (!editor || isLoading) return;
    const hasChips = pastedImages.length > 0;
    if (!checkHasContent(editor) && !hasChips) return;

    const json = editor.getJSON();
    const content = buildContent(editor);
    const mentions = extractMentions(json);
    onSend(content, mentions);
    editor.commands.clearContent();
    setPastedImages([]);
  }, [editor, isLoading, onSend, extractMentions, checkHasContent, pastedImages.length, buildContent]);

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
        {pastedImages.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-2 pb-1.5 border-b border-border/30">
            {pastedImages.map((img) => (
              <div
                key={img.id}
                className="relative w-16 h-16 rounded border border-border/50 bg-background overflow-hidden shrink-0"
                title={`📎 image ${img.index} (${img.mime})`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.base64} alt="" className="w-full h-full object-cover" />
                <span className="absolute bottom-0 left-0 right-0 bg-background/85 text-[10px] font-mono text-center text-amber-600 dark:text-amber-400 py-0.5 border-t border-border/40 leading-tight">
                  📎 {img.index}
                </span>
                <button
                  type="button"
                  onClick={() => removePastedImage(img.id)}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-background border border-border/60 flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive/60 transition-colors shadow-sm"
                  aria-label={`Remove image ${img.index}`}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
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
          disabled={isEmpty && pastedImages.length === 0}
          className="h-9 w-9 shrink-0"
        >
          <Send className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
