import { ReactRenderer } from "@tiptap/react";
import tippy, { Instance, Props } from "tippy.js";
import { MentionPopup, MentionPopupRef, MentionItem, UnifiedMentionPopup, UnifiedMentionPopupRef, UnifiedMentionItem } from "@/components/ui/mention-popup";
import { CardMentionPopup, CardMentionPopupRef, CardMentionItem } from "@/components/ui/card-mention-popup";
import { DocumentMentionPopup, DocumentMentionPopupRef, DocumentMentionItem } from "@/components/ui/document-mention-popup";
import { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import { Card, Project, DocumentFile, getDisplayId, UnifiedItem, UnifiedItemType } from "@/lib/types";

interface SuggestionConfig {
  char: string;
  items: string[];
  prefix: string;
  nodeType: string;
}

export function createSuggestion(config: SuggestionConfig): Omit<SuggestionOptions<MentionItem>, 'editor'> {
  return {
    char: config.char,
    allowSpaces: false,
    startOfLine: false,

    items: ({ query }) => {
      return config.items
        .filter((item) =>
          item.toLowerCase().includes(query.toLowerCase())
        )
        .slice(0, 10)
        .map((item) => ({
          id: item,
          label: item,
          prefix: config.prefix,
        }));
    },

    command: ({ editor, range, props }) => {
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          {
            type: config.nodeType,
            attrs: {
              id: props.id,
              label: props.label,
            },
          },
        ])
        .run();
    },

    render: () => {
      let component: ReactRenderer<MentionPopupRef>;
      let popup: Instance<Props>[];

      return {
        onStart: (props: SuggestionProps<MentionItem>) => {
          component = new ReactRenderer(MentionPopup, {
            props: {
              items: props.items,
              command: props.command,
            },
            editor: props.editor,
          });

          if (!props.clientRect) {
            return;
          }

          popup = tippy("body", {
            getReferenceClientRect: props.clientRect as () => DOMRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start",
          });
        },

        onUpdate(props: SuggestionProps<MentionItem>) {
          component.updateProps({
            items: props.items,
            command: props.command,
          });

          if (!props.clientRect) {
            return;
          }

          popup[0].setProps({
            getReferenceClientRect: props.clientRect as () => DOMRect,
          });
        },

        onKeyDown(props: { event: KeyboardEvent }) {
          if (props.event.key === "Escape") {
            popup[0].hide();
            return true;
          }

          return component.ref?.onKeyDown(props.event) ?? false;
        },

        onExit() {
          popup[0].destroy();
          component.destroy();
        },
      };
    },
  };
}

// Unified suggestion for / trigger (skills, MCPs, plugins)
interface UnifiedSuggestionConfig {
  getItems: () => UnifiedItem[];
}

export function createUnifiedSuggestion(
  config: UnifiedSuggestionConfig
): Omit<SuggestionOptions<UnifiedMentionItem>, "editor"> {
  return {
    char: "/",
    allowSpaces: false,
    startOfLine: false,

    items: ({ query }) => {
      const items = config.getItems();
      return items
        .filter((item) =>
          item.label.toLowerCase().includes(query.toLowerCase())
        )
        .slice(0, 10)
        .map((item) => ({
          id: item.id,
          label: item.label,
          type: item.type,
          description: item.description,
        }));
    },

    command: ({ editor, range, props }) => {
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          {
            type: "unifiedMention",
            attrs: {
              id: props.id,
              label: props.label,
              itemType: props.type,
            },
          },
        ])
        .run();
    },

    render: () => {
      let component: ReactRenderer<UnifiedMentionPopupRef>;
      let popup: Instance<Props>[];

      return {
        onStart: (props: SuggestionProps<UnifiedMentionItem>) => {
          component = new ReactRenderer(UnifiedMentionPopup, {
            props: {
              items: props.items,
              command: props.command,
            },
            editor: props.editor,
          });

          if (!props.clientRect) {
            return;
          }

          popup = tippy("body", {
            getReferenceClientRect: props.clientRect as () => DOMRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start",
          });
        },

        onUpdate(props: SuggestionProps<UnifiedMentionItem>) {
          component.updateProps({
            items: props.items,
            command: props.command,
          });

          if (!props.clientRect) {
            return;
          }

          popup[0].setProps({
            getReferenceClientRect: props.clientRect as () => DOMRect,
          });
        },

        onKeyDown(props: { event: KeyboardEvent }) {
          if (props.event.key === "Escape") {
            popup[0].hide();
            return true;
          }

          return component.ref?.onKeyDown(props.event) ?? false;
        },

        onExit() {
          popup[0].destroy();
          component.destroy();
        },
      };
    },
  };
}

// Card suggestion for [[ trigger
interface CardSuggestionConfig {
  cards: Card[];
  projects: Project[];
  activeProjectId: string | null;
  onCardClick?: (cardId: string) => void;
}

export function createCardSuggestion(
  config: CardSuggestionConfig
): Omit<SuggestionOptions<CardMentionItem>, "editor"> {
  return {
    char: "[",
    allowSpaces: true,
    startOfLine: false,

    // Custom match function to trigger on [[ or [[[
    findSuggestionMatch: (config) => {
      const { $position } = config;
      const text = $position.parent.textContent;
      const cursorPos = $position.parentOffset;

      // Look for [[[ (completed only) or [[ (all cards) pattern before cursor
      const textBeforeCursor = text.slice(0, cursorPos);

      // Try [[[ first (completed filter)
      const tripleMatch = textBeforeCursor.match(/\[\[\[([^\]]*)$/);
      if (tripleMatch) {
        const query = tripleMatch[1];
        const from = $position.pos - query.length - 3; // -3 for [[[
        const to = $position.pos;
        return {
          range: { from, to },
          query: `completed:${query}`, // Prefix to indicate completed filter
          text: tripleMatch[0],
        };
      }

      // Then try [[ (all cards)
      const doubleMatch = textBeforeCursor.match(/\[\[([^\]]*)$/);
      if (doubleMatch) {
        const query = doubleMatch[1];
        const from = $position.pos - query.length - 2; // -2 for [[
        const to = $position.pos;
        return {
          range: { from, to },
          query,
          text: doubleMatch[0],
        };
      }

      return null;
    },

    items: ({ query }) => {
      // Check if completed filter is active
      const completedOnly = query.startsWith("completed:");
      const searchQuery = completedOnly
        ? query.replace("completed:", "").toLowerCase()
        : query.toLowerCase();

      return config.cards
        .filter((card) => {
          // Filter by completed status if [[[ was used
          if (completedOnly && card.status !== "completed") return false;
          // Filter by active project if one is selected
          if (config.activeProjectId && card.projectId !== config.activeProjectId) return false;
          return true;
        })
        .map((card) => {
          const project = config.projects.find((p) => p.id === card.projectId);
          const displayId = getDisplayId(card, project);

          return {
            id: card.id,
            displayId,
            title: card.title,
            status: card.status,
            projectName: project?.name,
          };
        })
        .filter((item) => {
          if (!searchQuery) return true;
          const matchesDisplayId = item.displayId?.toLowerCase().includes(searchQuery);
          const matchesTitle = item.title.toLowerCase().includes(searchQuery);
          return matchesDisplayId || matchesTitle;
        })
        .slice(0, 10);
    },

    command: ({ editor, range, props }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent([
          {
            type: "cardMention",
            attrs: {
              id: props.id,
              displayId: props.displayId,
              title: props.title,
            },
          },
        ])
        .run();
    },

    render: () => {
      let component: ReactRenderer<CardMentionPopupRef>;
      let popup: Instance<Props>[];

      return {
        onStart: (props: SuggestionProps<CardMentionItem>) => {
          component = new ReactRenderer(CardMentionPopup, {
            props: {
              items: props.items,
              command: props.command,
            },
            editor: props.editor,
          });

          if (!props.clientRect) {
            return;
          }

          popup = tippy("body", {
            getReferenceClientRect: props.clientRect as () => DOMRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start",
          });
        },

        onUpdate(props: SuggestionProps<CardMentionItem>) {
          component.updateProps({
            items: props.items,
            command: props.command,
          });

          if (!props.clientRect) {
            return;
          }

          popup[0].setProps({
            getReferenceClientRect: props.clientRect as () => DOMRect,
          });
        },

        onKeyDown(props: { event: KeyboardEvent }) {
          if (props.event.key === "Escape") {
            popup[0].hide();
            return true;
          }

          return component.ref?.onKeyDown(props.event) ?? false;
        },

        onExit() {
          popup[0].destroy();
          component.destroy();
        },
      };
    },
  };
}

// Document suggestion for # trigger
interface DocumentSuggestionConfig {
  getDocuments: () => DocumentFile[];
}

export function createDocumentSuggestion(
  config: DocumentSuggestionConfig
): Omit<SuggestionOptions<DocumentMentionItem>, "editor"> {
  return {
    char: "#",
    allowSpaces: false,
    startOfLine: false,

    items: ({ query }) => {
      const searchQuery = query.toLowerCase();
      const documents = config.getDocuments();

      return documents
        .map((doc) => ({
          id: doc.relativePath,
          name: doc.name,
          relativePath: doc.relativePath,
          isClaudeMd: doc.isClaudeMd,
        }))
        .filter((item) => {
          if (!searchQuery) return true;
          return (
            item.name.toLowerCase().includes(searchQuery) ||
            item.relativePath.toLowerCase().includes(searchQuery)
          );
        })
        .sort((a, b) => {
          // CLAUDE.md files first
          if (a.isClaudeMd !== b.isClaudeMd) return a.isClaudeMd ? -1 : 1;
          return a.name.localeCompare(b.name);
        })
        .slice(0, 10);
    },

    command: ({ editor, range, props }) => {
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          {
            type: "documentMention",
            attrs: {
              id: props.id,
              name: props.name,
              path: props.relativePath,
              isClaudeMd: props.isClaudeMd,
            },
          },
        ])
        .run();
    },

    render: () => {
      let component: ReactRenderer<DocumentMentionPopupRef>;
      let popup: Instance<Props>[];

      return {
        onStart: (props: SuggestionProps<DocumentMentionItem>) => {
          component = new ReactRenderer(DocumentMentionPopup, {
            props: {
              items: props.items,
              command: props.command,
            },
            editor: props.editor,
          });

          if (!props.clientRect) {
            return;
          }

          popup = tippy("body", {
            getReferenceClientRect: props.clientRect as () => DOMRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start",
          });
        },

        onUpdate(props: SuggestionProps<DocumentMentionItem>) {
          component.updateProps({
            items: props.items,
            command: props.command,
          });

          if (!props.clientRect) {
            return;
          }

          popup[0].setProps({
            getReferenceClientRect: props.clientRect as () => DOMRect,
          });
        },

        onKeyDown(props: { event: KeyboardEvent }) {
          if (props.event.key === "Escape") {
            popup[0].hide();
            return true;
          }

          return component.ref?.onKeyDown(props.event) ?? false;
        },

        onExit() {
          popup[0].destroy();
          component.destroy();
        },
      };
    },
  };
}
