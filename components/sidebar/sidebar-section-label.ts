// Typography for every sidebar section label (Toolkit, Library, Documents,
// Memory, Pinned, All Projects, user sections). Layout classes — flex, gap,
// padding — stay at each call site, since the labels are a mix of triggers,
// buttons and plain spans.
export const SIDEBAR_SECTION_LABEL =
  "text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground";

// The count beside a section label. Resets the label's letter spacing so a
// two-digit count reads as one number, not "6 0".
export const SIDEBAR_SECTION_COUNT =
  "ml-auto text-[10px] font-normal normal-case tracking-normal tabular-nums opacity-60";
