import type { ResolvedSkillGroup } from "./grouping";

/**
 * Below this many entries a section is short enough to scan by eye, and the
 * search box costs more sidebar room than it saves.
 */
export const SEARCH_MIN_ITEMS = 8;

export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * Matches the board's card search: case-insensitive substring, name and
 * description alike. The description is where the value is — a skill's
 * trigger words live there, not in its name.
 */
export function matchesSearchQuery(
  item: { name: string; title?: string; description?: string | null },
  query: string
): boolean {
  if (!query) return true;
  return [item.name, item.title, item.description].some(
    (field) => !!field && field.toLowerCase().includes(query)
  );
}

/**
 * A group whose own name matches keeps all of its items: typing a group name
 * is a request to see that group, not to filter inside it.
 */
export function filterResolvedGroups(
  groups: ResolvedSkillGroup[],
  query: string
): ResolvedSkillGroup[] {
  if (!query) return groups;

  return groups.flatMap((group) => {
    const nameMatches = group.name.toLowerCase().includes(query);
    const items = nameMatches
      ? group.items
      : group.items.filter((item) => matchesSearchQuery(item, query));

    return items.length > 0 || nameMatches ? [{ ...group, items }] : [];
  });
}

export type MatchSegment = {
  text: string;
  match: boolean;
};

/** Splits text into alternating plain/matched runs so the hit can be marked. */
export function splitOnMatch(text: string, query: string): MatchSegment[] {
  if (!query) return [{ text, match: false }];

  const segments: MatchSegment[] = [];
  const haystack = text.toLowerCase();
  let cursor = 0;

  for (;;) {
    const at = haystack.indexOf(query, cursor);
    if (at === -1) {
      if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (at > cursor) segments.push({ text: text.slice(cursor, at), match: false });
    segments.push({ text: text.slice(at, at + query.length), match: true });
    cursor = at + query.length;
  }

  return segments;
}
