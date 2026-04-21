"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import ImageResize from "tiptap-extension-resize-image";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Send, Square } from "lucide-react";
import { useKanbanStore } from "@/lib/store";
import { UnifiedMention, CardMention, DocumentMention } from "@/lib/mention-extension";
import {
  createUnifiedSuggestion,
  createCardSuggestion,
  createDocumentSuggestion,
} from "@/lib/suggestion";
import { ImageAttachment } from "@/lib/image-attachment-extension";
import { MentionData, SectionType } from "@/lib/types";
import { usePastedImages } from "./conversation-input/use-pasted-images";
import { useProjectMentions } from "./conversation-input/use-project-mentions";
import { extractMentions } from "./conversation-input/extract-mentions";
import { PastedImageChips } from "./conversation-input/pasted-image-chips";

interface ConversationInputProps {
  cardId: string;
  sectionType: SectionType;
  projectId: string | null;
  isLoading: boolean;
  onSend: (content: string, mentions: MentionData[]) => void;
  onCancel?: () => void;
  placeholder?: string;
}

// Check if any suggestion popup is currently visible. TipTap suggestions use
// tippy popups marked with `data-tippy-root`.
function isSuggestionPopupOpen(): boolean {
  const tippyRoots = Array.from(document.querySelectorAll("[data-tippy-root]"));
  for (const root of tippyRoots) {
    const box = root.querySelector(".tippy-box");
    if (box && (!box.hasAttribute("data-state") || box.getAttribute("data-state") === "visible")) {
      return true;
    }
  }
  return false;
}

export function ConversationInput({
  cardId: _cardId,
  sectionType: _sectionType,
  projectId,
  isLoading,
  onSend,
  onCancel,
  placeholder = "Type a message...",
}: ConversationInputProps) {
  const { cards, projects, activeProjectId } = useKanbanStore();
  const [isEmpty, setIsEmpty] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    pastedImages,
    pastedImagesRef,
    addImage,
    removeImage,
    syncWithIds,
    clear: clearPastedImages,
  } = usePastedImages();

  const { getDocuments, getUnifiedItems } = useProjectMentions(projectId, activeProjectId);

  // Refs so editorProps don't capture stale props.
  const isLoadingRef = useRef(isLoading);
  const onSendRef = useRef(onSend);
  useLayoutEffect(() => {
    isLoadingRef.current = isLoading;
    onSendRef.current = onSend;
  }, [isLoading, onSend]);

  // editorRef lets removePastedImage reach the current editor without forcing
  // the callback identity to change on every editor re-render.
  const editorRef = useRef<ReturnType<typeof useEditor> | null>(null);

  const removePastedImage = useCallback(
    (id: string) => {
      removeImage(id);
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
    },
    [removeImage],
  );

  // Build the content string in the same shape the backend expects:
  // plain text when there are no images; HTML with embedded <img src="data:...">
  // when images are attached (extractConversationImages regex picks them up).
  const buildContent = useCallback(
    (ed: ReturnType<typeof useEditor>) => {
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
    },
    [pastedImagesRef],
  );

  // Suggestion factories — memoised on their inputs so the editor's extension
  // array stays stable across renders.
  const unifiedSuggestion = useMemo(
    () => createUnifiedSuggestion({ getItems: getUnifiedItems }),
    [getUnifiedItems],
  );

  const cardSuggestion = useMemo(
    () => createCardSuggestion({ cards, projects, activeProjectId }),
    [cards, projects, activeProjectId],
  );

  const documentSuggestion = useMemo(
    () => createDocumentSuggestion({ getDocuments }),
    [getDocuments],
  );

  const checkHasContent = useCallback((editor: ReturnType<typeof useEditor>) => {
    if (!editor) return false;
    const text = editor.getText().trim();
    if (text) return true;
    const json = editor.getJSON();
    return (
      JSON.stringify(json).includes('"type":"imageResize"') ||
      JSON.stringify(json).includes('"type":"image"')
    );
  }, []);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Placeholder.configure({ placeholder, emptyEditorClass: "is-editor-empty" }),
      ImageResize.configure({ inline: false, allowBase64: true }),
      UnifiedMention.configure({ suggestion: unifiedSuggestion }),
      CardMention.configure({ suggestion: cardSuggestion }),
      DocumentMention.configure({ suggestion: documentSuggestion }),
      ImageAttachment,
    ],
    [placeholder, unifiedSuggestion, cardSuggestion, documentSuggestion],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    editorProps: {
      attributes: { class: "prose-kanban chat-input-editor" },
      // Intercept image paste — push into chips state instead of inserting
      // an inline node so the editor height stays stable. An `imageAttachment`
      // node ("📎 image N") is inserted at the caret so the user sees where in
      // the message the image was attached and can reference it by number.
      // Backend `extractConversationImages` only matches base64 <img> tags,
      // so the span markers are passed through as decorative text.
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of Array.from(items)) {
          if (!item.type.startsWith("image/")) continue;
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
            const { id, index } = addImage(base64, item.type);
            const nodeType = view.state.schema.nodes.imageAttachment;
            if (nodeType) {
              view.dispatch(
                view.state.tr
                  .replaceSelectionWith(nodeType.create({ id, index }))
                  .scrollIntoView(),
              );
            }
          };
          reader.readAsDataURL(file);
          return true;
        }
        return false;
      },
      // Enter handling runs AFTER suggestion handlers. We use refs to avoid
      // recreating the editor instance when props change.
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && event.shiftKey) {
          event.preventDefault();
          if (editor) {
            editor.chain().focus().setHardBreak().scrollIntoView().run();
          }
          return true;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          if (isSuggestionPopupOpen()) {
            return false; // let suggestion handle it
          }

          event.preventDefault();

          const hasChips = pastedImagesRef.current.length > 0;
          if (editor && !isLoadingRef.current && (checkHasContent(editor) || hasChips)) {
            const json = editor.getJSON();
            const content = buildContent(editor);
            const mentions = extractMentions(json);
            onSendRef.current(content, mentions);
            editor.commands.clearContent();
            clearPastedImages();
          }
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      setIsEmpty(!checkHasContent(ed));
      // Sync doc → state: if the user backspaced an attachment marker out
      // of the editor, drop the matching chip from state.
      const aliveIds = new Set<string>();
      ed.state.doc.descendants((node) => {
        if (node.type.name === "imageAttachment") {
          aliveIds.add(node.attrs.id as string);
        }
      });
      syncWithIds(aliveIds);
    },
  });

  useLayoutEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  const handleSend = useCallback(() => {
    if (!editor || isLoading) return;
    const hasChips = pastedImages.length > 0;
    if (!checkHasContent(editor) && !hasChips) return;

    const json = editor.getJSON();
    const content = buildContent(editor);
    const mentions = extractMentions(json);
    onSend(content, mentions);
    editor.commands.clearContent();
    clearPastedImages();
  }, [editor, isLoading, onSend, checkHasContent, pastedImages.length, buildContent, clearPastedImages]);

  const handleCancel = useCallback(() => {
    onCancel?.();
  }, [onCancel]);

  return (
    <div className="flex items-end gap-2">
      <div
        ref={containerRef}
        className="flex-1 chat-input-container rounded-lg border border-border/50 bg-background/50 focus-within:border-accent/50 transition-colors"
      >
        <PastedImageChips images={pastedImages} onRemove={removePastedImage} />
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
