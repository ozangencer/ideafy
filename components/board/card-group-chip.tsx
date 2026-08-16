"use client";

import { CardGroup } from "@/lib/types";

/**
 * The group's short code, shown on the group row and again on each member's
 * face next to the display id. Same shape as the display-id chip so the two
 * read as one identity strip.
 *
 * A group with no colour falls back to the ink token rather than a hard-coded
 * hue — the chip has to stay legible in both themes, and the board already
 * spends its colour budget on project dots and status.
 */
export function CardGroupChip({ group }: { group: CardGroup }) {
  if (group.color) {
    return (
      <span
        className="text-[9px] font-mono tracking-wide px-1 py-0.5 rounded border shrink-0"
        style={{
          backgroundColor: `${group.color}1a`,
          borderColor: `${group.color}59`,
          color: group.color,
        }}
      >
        {group.code}
      </span>
    );
  }

  return (
    <span className="text-[9px] font-mono tracking-wide px-1 py-0.5 rounded border border-ink/25 bg-ink/10 text-ink shrink-0">
      {group.code}
    </span>
  );
}
