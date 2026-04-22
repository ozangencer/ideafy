import { Node, mergeAttributes } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { SuggestionOptions } from "@tiptap/suggestion";
import { MentionItem, UnifiedMentionItem } from "@/components/ui/mention-popup";
import { CardMentionItem } from "@/components/ui/card-mention-popup";
import { DocumentMentionItem } from "@/components/ui/document-mention-popup";
import { UnifiedItemType } from "@/lib/types";
import {
  backspaceMentionShortcut,
  boolDataAttr,
  dataAttr,
  idLabelAttrs,
  inlineAtomDefaults,
  mentionSuggestionPlugin,
} from "./shared-node";

// ----------------------------------------------------------------------
// Option shapes
// ----------------------------------------------------------------------

export interface MentionOptions {
  HTMLAttributes: Record<string, unknown>;
  suggestion: Omit<SuggestionOptions<MentionItem>, "editor">;
}

export interface UnifiedMentionOptions {
  HTMLAttributes: Record<string, unknown>;
  suggestion: Omit<SuggestionOptions<UnifiedMentionItem>, "editor">;
}

export interface CardMentionOptions {
  HTMLAttributes: Record<string, unknown>;
  suggestion: Omit<SuggestionOptions<CardMentionItem>, "editor">;
}

export interface DocumentMentionOptions {
  HTMLAttributes: Record<string, unknown>;
  suggestion: Omit<SuggestionOptions<DocumentMentionItem>, "editor">;
}

// ----------------------------------------------------------------------
// Plugin keys
// ----------------------------------------------------------------------

const SkillSuggestionPluginKey = new PluginKey("skillSuggestion");
const McpSuggestionPluginKey = new PluginKey("mcpSuggestion");
const UnifiedSuggestionPluginKey = new PluginKey("unifiedSuggestion");
const CardSuggestionPluginKey = new PluginKey("cardSuggestion");
const DocumentSuggestionPluginKey = new PluginKey("documentSuggestion");

function emptyItems<I>() {
  return () => [] as I[];
}

// ----------------------------------------------------------------------
// Skill / Mcp — identical `/label` mentions differing only by name + class.
// ----------------------------------------------------------------------

function createSlashMention(
  name: string,
  className: string,
  pluginKey: PluginKey,
) {
  return Node.create<MentionOptions>({
    name,
    ...inlineAtomDefaults,

    addOptions() {
      return {
        HTMLAttributes: {},
        suggestion: { char: "/", allowSpaces: false, items: emptyItems<MentionItem>() },
      };
    },

    addAttributes() {
      return idLabelAttrs();
    },

    parseHTML() {
      return [{ tag: `span[data-type="${this.name}"]` }];
    },

    renderHTML({ node, HTMLAttributes }) {
      return [
        "span",
        mergeAttributes(
          { "data-type": this.name },
          this.options.HTMLAttributes,
          HTMLAttributes,
          { class: `mention ${className}` },
        ),
        `/${node.attrs.label}`,
      ];
    },

    renderText({ node }) {
      return `/${node.attrs.label}`;
    },

    addKeyboardShortcuts() {
      return { Backspace: backspaceMentionShortcut(this.editor, this.name) };
    },

    addProseMirrorPlugins() {
      return [
        mentionSuggestionPlugin(this.editor, pluginKey, this.options.suggestion),
      ];
    },
  });
}

export const SkillMention = createSlashMention(
  "skillMention",
  "skill-mention",
  SkillSuggestionPluginKey,
);

export const McpMention = createSlashMention(
  "mcpMention",
  "mcp-mention",
  McpSuggestionPluginKey,
);

// ----------------------------------------------------------------------
// Unified mention — Skill/Mcp/Plugin behind a single `/` trigger with a
// type-tagged CSS class suffix.
// ----------------------------------------------------------------------

export const UnifiedMention = Node.create<UnifiedMentionOptions>({
  name: "unifiedMention",
  ...inlineAtomDefaults,

  addOptions() {
    return {
      HTMLAttributes: {},
      suggestion: { char: "/", allowSpaces: false, items: emptyItems<UnifiedMentionItem>() },
    };
  },

  addAttributes() {
    return {
      ...idLabelAttrs(),
      itemType: {
        default: "skill" as UnifiedItemType,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-item-type") as UnifiedItemType,
        renderHTML: (attributes: Record<string, any>) => {
          if (!attributes.itemType) return {};
          return { "data-item-type": attributes.itemType };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[data-type="${this.name}"]` }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const itemType = node.attrs.itemType as UnifiedItemType;
    return [
      "span",
      mergeAttributes(
        { "data-type": this.name },
        this.options.HTMLAttributes,
        HTMLAttributes,
        { class: `mention unified-mention unified-mention--${itemType}` },
      ),
      `/${node.attrs.label}`,
    ];
  },

  renderText({ node }) {
    return `/${node.attrs.label}`;
  },

  addKeyboardShortcuts() {
    return { Backspace: backspaceMentionShortcut(this.editor, this.name) };
  },

  addProseMirrorPlugins() {
    return [
      mentionSuggestionPlugin(this.editor, UnifiedSuggestionPluginKey, this.options.suggestion),
    ];
  },
});

// ----------------------------------------------------------------------
// Card mention — `[[displayId · title]]`
// ----------------------------------------------------------------------

function formatCardMention(attrs: Record<string, unknown>): string {
  const displayId = (attrs.displayId as string) || "";
  const title = (attrs.title as string) || "";
  if (displayId && title) return `${displayId} · ${title}`;
  return displayId || title || "Card";
}

export const CardMention = Node.create<CardMentionOptions>({
  name: "cardMention",
  ...inlineAtomDefaults,

  addOptions() {
    return {
      HTMLAttributes: {},
      suggestion: { char: "[", allowSpaces: true, items: emptyItems<CardMentionItem>() },
    };
  },

  addAttributes() {
    return {
      id: dataAttr("id"),
      displayId: dataAttr("displayId", "data-display-id"),
      title: dataAttr("title"),
    };
  },

  parseHTML() {
    return [{ tag: `span[data-type="${this.name}"]` }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const displayText = formatCardMention(node.attrs);
    return [
      "span",
      mergeAttributes(
        { "data-type": this.name },
        this.options.HTMLAttributes,
        HTMLAttributes,
        { class: "mention card-mention" },
      ),
      `[[${displayText}]]`,
    ];
  },

  renderText({ node }) {
    return `[[${formatCardMention(node.attrs)}]]`;
  },

  addKeyboardShortcuts() {
    return { Backspace: backspaceMentionShortcut(this.editor, this.name) };
  },

  addProseMirrorPlugins() {
    return [
      mentionSuggestionPlugin(this.editor, CardSuggestionPluginKey, this.options.suggestion),
    ];
  },
});

// ----------------------------------------------------------------------
// Document mention — `@filename` (with CLAUDE.md hint class)
// ----------------------------------------------------------------------

export const DocumentMention = Node.create<DocumentMentionOptions>({
  name: "documentMention",
  ...inlineAtomDefaults,

  addOptions() {
    return {
      HTMLAttributes: {},
      suggestion: { char: "@", allowSpaces: false, items: emptyItems<DocumentMentionItem>() },
    };
  },

  addAttributes() {
    return {
      id: dataAttr("id"),
      name: dataAttr("name"),
      path: dataAttr("path"),
      isClaudeMd: boolDataAttr("isClaudeMd", "data-is-claude-md"),
      isMemory: boolDataAttr("isMemory", "data-is-memory"),
      absolutePath: dataAttr("absolutePath", "data-absolute-path"),
    };
  },

  parseHTML() {
    return [{ tag: `span[data-type="${this.name}"]` }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const isClaudeMd = node.attrs.isClaudeMd;
    const isMemory = node.attrs.isMemory;
    return [
      "span",
      mergeAttributes(
        { "data-type": this.name },
        this.options.HTMLAttributes,
        HTMLAttributes,
        {
          class: `mention document-mention${isClaudeMd ? " claude-md" : ""}${
            isMemory ? " memory" : ""
          }`,
        },
      ),
      `@${node.attrs.name}`,
    ];
  },

  renderText({ node }) {
    // Memory files live outside the project's cwd; emit the absolute path so
    // Claude CLI can resolve the @-reference. Visible chip still shows @name.
    if (node.attrs.isMemory && node.attrs.absolutePath) {
      return `@${node.attrs.absolutePath}`;
    }
    return `@${node.attrs.name}`;
  },

  addKeyboardShortcuts() {
    return { Backspace: backspaceMentionShortcut(this.editor, this.name) };
  },

  addProseMirrorPlugins() {
    return [
      mentionSuggestionPlugin(this.editor, DocumentSuggestionPluginKey, this.options.suggestion),
    ];
  },
});
