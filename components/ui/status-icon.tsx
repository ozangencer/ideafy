"use client";

import { useId } from "react";
import { STATUS_TEXT_COLORS, type Status } from "@/lib/types";

interface StatusIconProps {
  status: Status;
  size?: number;
  className?: string;
}

/**
 * One family of rings for every status mark in the app. The ring fills as the
 * work moves on — empty backlog, half-full in progress, three quarters in
 * test, a full disc once it is done — so the shape reads even where the
 * colour does not. Ideation is a dotted ring (not shaped yet) and Bugs a ring
 * with a return arrow (work that came back). The glyphs live only here; a
 * hand-drawn set copied around drifts apart.
 *
 * The colour class sits on the svg itself: highlighted menu rows switch their
 * text to the accent foreground, and a ring drawn in currentColor would follow.
 */
export function StatusIcon({ status, size = 14, className = "" }: StatusIconProps) {
  // The check and x are cut out with a mask rather than drawn in the
  // background colour, so the disc reads the same on a column, a card, a chip
  // or a highlighted row. Each instance needs its own mask: a shared id that
  // first resolves inside a closed popover leaves every disc a plain circle.
  const maskId = `status-cut-${useId().replace(/:/g, "")}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // Inline, because menu items size every child svg to 16px by class.
      style={{ width: size, height: size }}
      className={`shrink-0 ${STATUS_TEXT_COLORS[status]} ${className}`}
    >
      {renderGlyph(status, maskId)}
    </svg>
  );
}

function renderGlyph(status: Status, maskId: string) {
  switch (status) {
    case "ideation":
      return <circle cx="7" cy="7" r="5.5" strokeDasharray="1.1 2.35" />;
    case "backlog":
      return <circle cx="7" cy="7" r="5.5" />;
    case "bugs":
      return (
        <>
          <circle cx="7" cy="7" r="5.5" />
          <path d="M9.3 7.6A2.4 2.4 0 1 1 8.6 5.2" strokeWidth={1.3} />
          <path d="M8.9 3.9v1.6H7.3" strokeWidth={1.3} />
        </>
      );
    case "progress":
      return (
        <>
          <circle cx="7" cy="7" r="5.5" />
          <path d="M7 4A3 3 0 0 1 7 10Z" fill="currentColor" stroke="none" />
        </>
      );
    case "test":
      return (
        <>
          <circle cx="7" cy="7" r="5.5" />
          <path d="M7 4A3 3 0 1 1 4 7L7 7Z" fill="currentColor" stroke="none" />
        </>
      );
    case "completed":
      return <CutDisc maskId={maskId} d="M4.5 7.2 6.2 8.9 9.5 5.5" />;
    case "withdrawn":
      return <CutDisc maskId={maskId} d="M5 5l4 4M9 5l-4 4" />;
  }
}

function CutDisc({ maskId, d }: { maskId: string; d: string }) {
  return (
    <>
      <defs>
        <mask id={maskId}>
          <rect width="14" height="14" fill="#fff" />
          <path d={d} stroke="#000" strokeWidth={1.6} />
        </mask>
      </defs>
      <circle cx="7" cy="7" r="6.25" fill="currentColor" stroke="none" mask={`url(#${maskId})`} />
    </>
  );
}
