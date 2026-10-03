import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { findEstimateMarkers } from "./estimate-markers";

const estimateMarkersKey = new PluginKey<DecorationSet>("estimateMarkers");

function buildDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    // A marker quoted inside code is an example, not the card's estimate.
    if (node.type.spec.code) return false;
    if (!node.isText || !node.text) return;
    if (node.marks.some((mark) => mark.type.spec.code)) return;
    for (const match of findEstimateMarkers(node.text)) {
      // Overlapping inline decorations split into sibling spans anyway, so lay
      // the chip out as three adjacent pieces: `[KEY: ` · value · `]`.
      const base = `estimate-marker estimate-marker--${match.kind}`;
      decorations.push(
        Decoration.inline(pos + match.from, pos + match.valueFrom, {
          class: `${base} estimate-marker__start`,
        }),
        Decoration.inline(pos + match.valueFrom, pos + match.valueTo, {
          class: `${base} estimate-marker__value`,
          ...(match.level ? { "data-level": match.level } : {}),
        }),
        Decoration.inline(pos + match.valueTo, pos + match.to, {
          class: `${base} estimate-marker__end`,
        }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * Paints `[COMPLEXITY: …]` / `[PRIORITY: …]` / `[VERDICT: …]` / `[SCORE: …]`
 * as chips. Decorations only: the stored HTML stays plain text, so old cards
 * light up without a migration and lib/opinion-markers.ts keeps reading the
 * same string.
 */
export const EstimateMarkers = Extension.create({
  name: "estimateMarkers",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: estimateMarkersKey,
        state: {
          init: (_, { doc }) => buildDecorations(doc),
          apply: (tr, old) => (tr.docChanged ? buildDecorations(tr.doc) : old),
        },
        props: {
          decorations: (state) => estimateMarkersKey.getState(state),
        },
      }),
    ];
  },
});
