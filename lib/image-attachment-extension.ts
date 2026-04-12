import { Node, mergeAttributes } from "@tiptap/core";

export const ImageAttachment = Node.create({
  name: "imageAttachment",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-id"),
        renderHTML: (attrs) => ({ "data-id": attrs.id }),
      },
      index: {
        default: 1,
        parseHTML: (el) => Number((el as HTMLElement).getAttribute("data-index")) || 1,
        renderHTML: (attrs) => ({ "data-index": String(attrs.index) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="imageAttachment"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(
        { "data-type": "imageAttachment", class: "image-attachment" },
        HTMLAttributes,
      ),
      `📎 image ${node.attrs.index}`,
    ];
  },
});
