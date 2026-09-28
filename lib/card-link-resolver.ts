import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { linkCardReferences, type CardResolver, type LinkedCard } from "@/lib/card-links";

// Resolves "IDE-318" to a card. The card's own project wins when two projects
// share a prefix; otherwise a prefix only resolves when exactly one project
// uses it.
export function createCardResolver(projectId: string | null | undefined): CardResolver {
  let projects: Array<{ id: string; idPrefix: string }> | null = null;
  const cache = new Map<string, LinkedCard | null>();

  return (displayId) => {
    if (cache.has(displayId)) return cache.get(displayId)!;

    const match = displayId.match(/^([A-Z][A-Z0-9]*)-(\d+)$/);
    let found: LinkedCard | null = null;
    if (match) {
      projects ??= db
        .select({ id: schema.projects.id, idPrefix: schema.projects.idPrefix })
        .from(schema.projects)
        .all();
      const [, prefix, number] = match;
      const owners = projects.filter((p) => p.idPrefix === prefix);
      const owner = owners.find((p) => p.id === projectId) ?? (owners.length === 1 ? owners[0] : null);
      if (owner) {
        const card = db
          .select({ id: schema.cards.id, title: schema.cards.title })
          .from(schema.cards)
          .where(and(eq(schema.cards.projectId, owner.id), eq(schema.cards.taskNumber, Number(number))))
          .get();
        if (card) found = { id: card.id, displayId, title: card.title };
      }
    }

    cache.set(displayId, found);
    return found;
  };
}

export function linkCardsInHtml(html: string, projectId: string | null | undefined): string {
  return linkCardReferences(html, createCardResolver(projectId));
}
