import { SuggestionOptions } from "@tiptap/suggestion";
import {
  MentionItem,
  MentionPopup,
  MentionPopupRef,
  UnifiedMentionItem,
  UnifiedMentionPopup,
  UnifiedMentionPopupRef,
} from "@/components/ui/mention-popup";
import {
  CardMentionItem,
  CardMentionPopup,
  CardMentionPopupRef,
} from "@/components/ui/card-mention-popup";
import {
  DocumentMentionItem,
  DocumentMentionPopup,
  DocumentMentionPopupRef,
} from "@/components/ui/document-mention-popup";
import {
  Card,
  Project,
  DocumentFile,
  UnifiedItem,
  getDisplayId,
} from "@/lib/types";
import { createTippyRenderer } from "./shared-render";

// ----------------------------------------------------------------------
// Generic string-list suggestion used for early skill/mcp triggers.
// ----------------------------------------------------------------------

interface SuggestionConfig {
  char: string;
  items: string[];
  prefix: string;
  nodeType: string;
}

export function createSuggestion(
  config: SuggestionConfig,
): Omit<SuggestionOptions<MentionItem>, "editor"> {
  return {
    char: config.char,
    allowSpaces: false,
    startOfLine: false,

    items: ({ query }) =>
      config.items
        .filter((item) => item.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 10)
        .map((item) => ({ id: item, label: item, prefix: config.prefix })),

    command: ({ editor, range, props }) => {
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          {
            type: config.nodeType,
            attrs: { id: props.id, label: props.label },
          },
        ])
        .run();
    },

    render: createTippyRenderer<MentionItem, MentionPopupRef>(MentionPopup),
  };
}

// ----------------------------------------------------------------------
// Unified (skills + MCPs + plugins) behind the `/` trigger.
// ----------------------------------------------------------------------

interface UnifiedSuggestionConfig {
  getItems: () => UnifiedItem[];
}

export function createUnifiedSuggestion(
  config: UnifiedSuggestionConfig,
): Omit<SuggestionOptions<UnifiedMentionItem>, "editor"> {
  return {
    char: "/",
    allowSpaces: false,
    startOfLine: false,

    items: ({ query }) =>
      config
        .getItems()
        .filter((item) =>
          item.label.toLowerCase().includes(query.toLowerCase()),
        )
        .sort((a, b) => {
          if (a.type === "skillGroup" && b.type !== "skillGroup") return -1;
          if (a.type !== "skillGroup" && b.type === "skillGroup") return 1;
          return a.label.localeCompare(b.label);
        })
        .map((item) => ({
          id: item.id,
          label: item.label,
          type: item.type,
          description: item.description,
          children: item.children,
        })),

    command: ({ editor, range, props }) => {
      if (props.type === "skillGroup") return;

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

    render: createTippyRenderer<UnifiedMentionItem, UnifiedMentionPopupRef>(
      UnifiedMentionPopup,
    ),
  };
}

// ----------------------------------------------------------------------
// Card suggestion — `[[query]]` for any card, `[[[query]]]` for completed only.
// ----------------------------------------------------------------------

interface CardSuggestionConfig {
  cards: Card[];
  projects: Project[];
  activeProjectId: string | null;
  onCardClick?: (cardId: string) => void;
}

const COMPLETED_PREFIX = "completed:";

export function createCardSuggestion(
  config: CardSuggestionConfig,
): Omit<SuggestionOptions<CardMentionItem>, "editor"> {
  return {
    char: "[",
    allowSpaces: true,
    startOfLine: false,

    // `[[[` triggers a completed-only filter; `[[` lists all cards. The
    // prefix is encoded into the query string and unpacked in `items()`.
    findSuggestionMatch: ({ $position }) => {
      const textBeforeCursor = $position.parent.textContent.slice(0, $position.parentOffset);

      const tripleMatch = textBeforeCursor.match(/\[\[\[([^\]]*)$/);
      if (tripleMatch) {
        const query = tripleMatch[1];
        return {
          range: { from: $position.pos - query.length - 3, to: $position.pos },
          query: `${COMPLETED_PREFIX}${query}`,
          text: tripleMatch[0],
        };
      }

      const doubleMatch = textBeforeCursor.match(/\[\[([^\]]*)$/);
      if (doubleMatch) {
        const query = doubleMatch[1];
        return {
          range: { from: $position.pos - query.length - 2, to: $position.pos },
          query,
          text: doubleMatch[0],
        };
      }

      return null;
    },

    items: ({ query }) => {
      const completedOnly = query.startsWith(COMPLETED_PREFIX);
      const searchQuery = completedOnly
        ? query.slice(COMPLETED_PREFIX.length).toLowerCase()
        : query.toLowerCase();

      return config.cards
        .filter((card) => {
          if (completedOnly && card.status !== "completed") return false;
          if (config.activeProjectId && card.projectId !== config.activeProjectId) return false;
          return true;
        })
        .map((card) => {
          const project = config.projects.find((p) => p.id === card.projectId);
          return {
            id: card.id,
            displayId: getDisplayId(card, project),
            title: card.title,
            status: card.status,
            projectName: project?.name,
          };
        })
        .filter((item) => {
          if (!searchQuery) return true;
          return (
            item.displayId?.toLowerCase().includes(searchQuery) ||
            item.title.toLowerCase().includes(searchQuery)
          );
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

    render: createTippyRenderer<CardMentionItem, CardMentionPopupRef>(CardMentionPopup),
  };
}

// ----------------------------------------------------------------------
// Document suggestion — `@filename`, CLAUDE.md files sorted first.
// ----------------------------------------------------------------------

interface DocumentSuggestionConfig {
  getDocuments: () => DocumentFile[];
}

export function createDocumentSuggestion(
  config: DocumentSuggestionConfig,
): Omit<SuggestionOptions<DocumentMentionItem>, "editor"> {
  return {
    char: "@",
    allowSpaces: false,
    startOfLine: false,

    items: ({ query }) => {
      const searchQuery = query.toLowerCase();
      return config
        .getDocuments()
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

    render: createTippyRenderer<DocumentMentionItem, DocumentMentionPopupRef>(
      DocumentMentionPopup,
    ),
  };
}
