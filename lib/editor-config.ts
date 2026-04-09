import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import ImageResize from "tiptap-extension-resize-image";
import { Fragment, Slice } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { SkillMention, McpMention, UnifiedMention, CardMention, DocumentMention } from "@/lib/mention-extension";

// Base extensions used by both content editor and chat input
export function getBaseExtensions(placeholder: string = "Write here...") {
  return [
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
    ImageResize.configure({
      inline: false,
      allowBase64: true,
    }),
  ];
}

// Mention extensions factory (legacy - keeping for backward compatibility)
export function getMentionExtensions(config: {
  skillSuggestion: ReturnType<typeof import("@/lib/suggestion").createSuggestion>;
  mcpSuggestion: ReturnType<typeof import("@/lib/suggestion").createSuggestion>;
  cardSuggestion: ReturnType<typeof import("@/lib/suggestion").createCardSuggestion>;
  documentSuggestion: ReturnType<typeof import("@/lib/suggestion").createDocumentSuggestion>;
}) {
  return [
    SkillMention.configure({
      suggestion: config.skillSuggestion,
    }),
    McpMention.configure({
      suggestion: config.mcpSuggestion,
    }),
    CardMention.configure({
      suggestion: config.cardSuggestion,
    }),
    DocumentMention.configure({
      suggestion: config.documentSuggestion,
    }),
  ];
}

// Unified mention extensions factory (new - uses / trigger for skills, MCPs, plugins)
export function getUnifiedMentionExtensions(config: {
  unifiedSuggestion: ReturnType<typeof import("@/lib/suggestion").createUnifiedSuggestion>;
  cardSuggestion: ReturnType<typeof import("@/lib/suggestion").createCardSuggestion>;
  documentSuggestion: ReturnType<typeof import("@/lib/suggestion").createDocumentSuggestion>;
}) {
  return [
    UnifiedMention.configure({
      suggestion: config.unifiedSuggestion,
    }),
    CardMention.configure({
      suggestion: config.cardSuggestion,
    }),
    DocumentMention.configure({
      suggestion: config.documentSuggestion,
    }),
  ];
}

// Chat input extensions - simpler config without headings but with image support
export function getChatInputExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      heading: false,
      codeBlock: false,
    }),
    Placeholder.configure({
      placeholder,
      emptyEditorClass: "is-editor-empty",
    }),
    ImageResize.configure({
      inline: false,
      allowBase64: true,
    }),
  ];
}

// Common editor props
export const commonEditorProps = {
  handlePaste: (view: import("@tiptap/pm/view").EditorView, event: ClipboardEvent) => {
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
            const imageNode = nodeType.create({ src: base64 });
            const paragraphNode = view.state.schema.nodes.paragraph.create();
            const fragment = Fragment.from([imageNode, paragraphNode]);
            const tr = view.state.tr.replaceSelection(
              new Slice(fragment, 0, 0)
            );
            // Move cursor into the new paragraph after the image
            tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(view.state.selection.from) + imageNode.nodeSize)));
            view.dispatch(tr);
            view.focus();
          }
        };
        reader.readAsDataURL(file);
        return true;
      }
    }
    return false;
  },
};
