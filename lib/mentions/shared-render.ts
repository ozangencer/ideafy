import { ComponentType } from "react";
import { ReactRenderer } from "@tiptap/react";
import tippy, { Instance, Props } from "tippy.js";
import { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";

interface PopupRefLike {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

/**
 * Shared lifecycle for the tippy.js popup backing every mention suggestion:
 * mounts a React component inside a tippy instance, forwards prop updates,
 * and routes Escape + other keys to the popup's imperative handle.
 *
 * Pass the item type `I` for typed `items`/`command`, and the popup's ref
 * type `R` so `component.ref?.onKeyDown` is properly typed.
 */
export function createTippyRenderer<I, R extends PopupRefLike>(
  Component: ComponentType<{ items: I[]; command: (item: I) => void }>,
): NonNullable<SuggestionOptions<I>["render"]> {
  return () => {
    let component: ReactRenderer<R>;
    let popup: Instance<Props>[];

    return {
      onStart: (props: SuggestionProps<I>) => {
        component = new ReactRenderer<R>(Component as ComponentType<unknown>, {
          props: {
            items: props.items,
            command: props.command,
          },
          editor: props.editor,
        });

        if (!props.clientRect) return;

        popup = tippy("body", {
          getReferenceClientRect: props.clientRect as () => DOMRect,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: "manual",
          placement: "bottom-start",
        });

        if (props.items.length === 0) {
          popup[0].hide();
        }
      },

      onUpdate(props: SuggestionProps<I>) {
        component.updateProps({
          items: props.items,
          command: props.command,
        });

        if (!props.clientRect) return;

        popup[0].setProps({
          getReferenceClientRect: props.clientRect as () => DOMRect,
        });

        // Hide whenever the active query has no matches. The suggestion
        // plugin stays armed underneath; the popup re-appears as soon as
        // the user backspaces or types something that matches again. This
        // mirrors Notion/Linear and prevents "No cards found" from
        // sticking under prose like "/, @, [[".
        if (props.items.length === 0) {
          popup[0].hide();
        } else {
          popup[0].show();
        }
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
  };
}
