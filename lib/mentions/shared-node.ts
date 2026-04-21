import { Editor } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { SuggestionOptions } from "@tiptap/suggestion";

// Every mention node is an inline atomic span the user cannot select into.
export const inlineAtomDefaults = {
  group: "inline" as const,
  inline: true as const,
  selectable: false as const,
  atom: true as const,
};

/** Tiptap attribute backed by a single `data-*` HTML attribute (string value). */
export function dataAttr(name: string, dataKey = `data-${name}`) {
  return {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute(dataKey),
    renderHTML: (attributes: Record<string, any>) => {
      const value = attributes[name];
      if (!value) return {};
      return { [dataKey]: value };
    },
  };
}

/** Tiptap attribute backed by a `data-*` HTML attribute holding a "true"/"false" boolean. */
export function boolDataAttr(name: string, dataKey = `data-${name}`) {
  return {
    default: false,
    parseHTML: (element: HTMLElement) => element.getAttribute(dataKey) === "true",
    renderHTML: (attributes: Record<string, any>) => ({
      [dataKey]: attributes[name] ? "true" : "false",
    }),
  };
}

/** Shared id+label attribute pair used by the skill/mcp/unified mentions. */
export function idLabelAttrs() {
  return {
    id: dataAttr("id"),
    label: dataAttr("label"),
  };
}

/**
 * Backspace handler shared by every mention node: when the cursor sits just
 * after a mention node of the given name, delete it atomically instead of
 * nibbling at its last character.
 */
export function backspaceMentionShortcut(editor: Editor, nodeName: string) {
  return () =>
    editor.commands.command(({ tr, state }) => {
      let isMention = false;
      const { selection } = state;
      const { empty, anchor } = selection;

      if (!empty) return false;

      state.doc.nodesBetween(anchor - 1, anchor, (node, pos) => {
        if (node.type.name === nodeName) {
          isMention = true;
          tr.insertText("", pos, pos + node.nodeSize);
          return false;
        }
      });

      return isMention;
    });
}

/** Standard ProseMirror suggestion plugin wiring used by every mention node. */
export function mentionSuggestionPlugin<I>(
  editor: Editor,
  pluginKey: PluginKey,
  suggestion: Omit<SuggestionOptions<I>, "editor">,
) {
  return Suggestion({
    editor,
    pluginKey,
    ...suggestion,
  });
}
