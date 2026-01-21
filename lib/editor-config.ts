import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import ImageResize from "tiptap-extension-resize-image";
import { SkillMention, McpMention, CardMention, DocumentMention } from "@/lib/mention-extension";

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

// Mention extensions factory
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
};
