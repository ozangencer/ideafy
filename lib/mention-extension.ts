import { Node, mergeAttributes } from "@tiptap/core";
import Suggestion, { SuggestionOptions } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { MentionItem, UnifiedMentionItem } from "@/components/ui/mention-popup";
import { CardMentionItem } from "@/components/ui/card-mention-popup";
import { DocumentMentionItem } from "@/components/ui/document-mention-popup";
import { UnifiedItemType } from "@/lib/types";

const SkillSuggestionPluginKey = new PluginKey("skillSuggestion");
const McpSuggestionPluginKey = new PluginKey("mcpSuggestion");
const UnifiedSuggestionPluginKey = new PluginKey("unifiedSuggestion");
const CardSuggestionPluginKey = new PluginKey("cardSuggestion");
const DocumentSuggestionPluginKey = new PluginKey("documentSuggestion");

export interface MentionOptions {
  HTMLAttributes: Record<string, unknown>;
  suggestion: Omit<SuggestionOptions<MentionItem>, "editor">;
}

export const SkillMention = Node.create<MentionOptions>({
  name: "skillMention",
  group: "inline",
  inline: true,
  selectable: false,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      suggestion: {
        char: "/",
        allowSpaces: false,
        items: () => [],
      },
    };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-id"),
        renderHTML: (attributes) => {
          if (!attributes.id) return {};
          return { "data-id": attributes.id };
        },
      },
      label: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-label"),
        renderHTML: (attributes) => {
          if (!attributes.label) return {};
          return { "data-label": attributes.label };
        },
      },
    };
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
        {
          class: "mention skill-mention",
        }
      ),
      `/${node.attrs.label}`,
    ];
  },

  renderText({ node }) {
    return `/${node.attrs.label}`;
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () =>
        this.editor.commands.command(({ tr, state }) => {
          let isMention = false;
          const { selection } = state;
          const { empty, anchor } = selection;

          if (!empty) return false;

          state.doc.nodesBetween(anchor - 1, anchor, (node, pos) => {
            if (node.type.name === this.name) {
              isMention = true;
              tr.insertText("", pos, pos + node.nodeSize);
              return false;
            }
          });

          return isMention;
        }),
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: SkillSuggestionPluginKey,
        ...this.options.suggestion,
      }),
    ];
  },
});

export const McpMention = Node.create<MentionOptions>({
  name: "mcpMention",
  group: "inline",
  inline: true,
  selectable: false,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      suggestion: {
        char: "/",
        allowSpaces: false,
        items: () => [],
      },
    };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-id"),
        renderHTML: (attributes) => {
          if (!attributes.id) return {};
          return { "data-id": attributes.id };
        },
      },
      label: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-label"),
        renderHTML: (attributes) => {
          if (!attributes.label) return {};
          return { "data-label": attributes.label };
        },
      },
    };
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
        {
          class: "mention mcp-mention",
        }
      ),
      `/${node.attrs.label}`,
    ];
  },

  renderText({ node }) {
    return `/${node.attrs.label}`;
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () =>
        this.editor.commands.command(({ tr, state }) => {
          let isMention = false;
          const { selection } = state;
          const { empty, anchor } = selection;

          if (!empty) return false;

          state.doc.nodesBetween(anchor - 1, anchor, (node, pos) => {
            if (node.type.name === this.name) {
              isMention = true;
              tr.insertText("", pos, pos + node.nodeSize);
              return false;
            }
          });

          return isMention;
        }),
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: McpSuggestionPluginKey,
        ...this.options.suggestion,
      }),
    ];
  },
});

// Unified Mention Options (skills, MCPs, plugins with / trigger)
export interface UnifiedMentionOptions {
  HTMLAttributes: Record<string, unknown>;
  suggestion: Omit<SuggestionOptions<UnifiedMentionItem>, "editor">;
}

export const UnifiedMention = Node.create<UnifiedMentionOptions>({
  name: "unifiedMention",
  group: "inline",
  inline: true,
  selectable: false,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      suggestion: {
        char: "/",
        allowSpaces: false,
        items: () => [],
      },
    };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-id"),
        renderHTML: (attributes) => {
          if (!attributes.id) return {};
          return { "data-id": attributes.id };
        },
      },
      label: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-label"),
        renderHTML: (attributes) => {
          if (!attributes.label) return {};
          return { "data-label": attributes.label };
        },
      },
      itemType: {
        default: "skill" as UnifiedItemType,
        parseHTML: (element) => element.getAttribute("data-item-type") as UnifiedItemType,
        renderHTML: (attributes) => {
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
        {
          class: `mention unified-mention unified-mention--${itemType}`,
        }
      ),
      `/${node.attrs.label}`,
    ];
  },

  renderText({ node }) {
    return `/${node.attrs.label}`;
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () =>
        this.editor.commands.command(({ tr, state }) => {
          let isMention = false;
          const { selection } = state;
          const { empty, anchor } = selection;

          if (!empty) return false;

          state.doc.nodesBetween(anchor - 1, anchor, (node, pos) => {
            if (node.type.name === this.name) {
              isMention = true;
              tr.insertText("", pos, pos + node.nodeSize);
              return false;
            }
          });

          return isMention;
        }),
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: UnifiedSuggestionPluginKey,
        ...this.options.suggestion,
      }),
    ];
  },
});

// Card Mention Options
export interface CardMentionOptions {
  HTMLAttributes: Record<string, unknown>;
  suggestion: Omit<SuggestionOptions<CardMentionItem>, "editor">;
}

export const CardMention = Node.create<CardMentionOptions>({
  name: "cardMention",
  group: "inline",
  inline: true,
  selectable: false,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      suggestion: {
        char: "[",
        allowSpaces: true,
        items: () => [],
      },
    };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-id"),
        renderHTML: (attributes) => {
          if (!attributes.id) return {};
          return { "data-id": attributes.id };
        },
      },
      displayId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-display-id"),
        renderHTML: (attributes) => {
          if (!attributes.displayId) return {};
          return { "data-display-id": attributes.displayId };
        },
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-title"),
        renderHTML: (attributes) => {
          if (!attributes.title) return {};
          return { "data-title": attributes.title };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[data-type="${this.name}"]` }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const displayText = node.attrs.displayId || node.attrs.title || "Card";
    return [
      "span",
      mergeAttributes(
        { "data-type": this.name },
        this.options.HTMLAttributes,
        HTMLAttributes,
        {
          class: "mention card-mention",
        }
      ),
      `[[${displayText}]]`,
    ];
  },

  renderText({ node }) {
    const displayText = node.attrs.displayId || node.attrs.title || "Card";
    return `[[${displayText}]]`;
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () =>
        this.editor.commands.command(({ tr, state }) => {
          let isMention = false;
          const { selection } = state;
          const { empty, anchor } = selection;

          if (!empty) return false;

          state.doc.nodesBetween(anchor - 1, anchor, (node, pos) => {
            if (node.type.name === this.name) {
              isMention = true;
              tr.insertText("", pos, pos + node.nodeSize);
              return false;
            }
          });

          return isMention;
        }),
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: CardSuggestionPluginKey,
        ...this.options.suggestion,
      }),
    ];
  },
});

// Document Mention Options
export interface DocumentMentionOptions {
  HTMLAttributes: Record<string, unknown>;
  suggestion: Omit<SuggestionOptions<DocumentMentionItem>, "editor">;
}

export const DocumentMention = Node.create<DocumentMentionOptions>({
  name: "documentMention",
  group: "inline",
  inline: true,
  selectable: false,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      suggestion: {
        char: "#",
        allowSpaces: false,
        items: () => [],
      },
    };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-id"),
        renderHTML: (attributes) => {
          if (!attributes.id) return {};
          return { "data-id": attributes.id };
        },
      },
      name: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-name"),
        renderHTML: (attributes) => {
          if (!attributes.name) return {};
          return { "data-name": attributes.name };
        },
      },
      path: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-path"),
        renderHTML: (attributes) => {
          if (!attributes.path) return {};
          return { "data-path": attributes.path };
        },
      },
      isClaudeMd: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-is-claude-md") === "true",
        renderHTML: (attributes) => {
          return { "data-is-claude-md": attributes.isClaudeMd ? "true" : "false" };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[data-type="${this.name}"]` }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const isClaudeMd = node.attrs.isClaudeMd;
    return [
      "span",
      mergeAttributes(
        { "data-type": this.name },
        this.options.HTMLAttributes,
        HTMLAttributes,
        {
          class: `mention document-mention${isClaudeMd ? " claude-md" : ""}`,
        }
      ),
      `#${node.attrs.name}`,
    ];
  },

  renderText({ node }) {
    return `#${node.attrs.name}`;
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () =>
        this.editor.commands.command(({ tr, state }) => {
          let isMention = false;
          const { selection } = state;
          const { empty, anchor } = selection;

          if (!empty) return false;

          state.doc.nodesBetween(anchor - 1, anchor, (node, pos) => {
            if (node.type.name === this.name) {
              isMention = true;
              tr.insertText("", pos, pos + node.nodeSize);
              return false;
            }
          });

          return isMention;
        }),
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: DocumentSuggestionPluginKey,
        ...this.options.suggestion,
      }),
    ];
  },
});
