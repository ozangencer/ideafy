import type { ParsedRunOutput } from "../platform/types";

/**
 * What a run's output has to look like for a given phase to be recognisable as
 * that phase's product. Derived from what the phase prompt demands, so a prompt
 * edit that orphans a contract is a test failure rather than a silent
 * degradation (see mcp-server/__tests__/run-output.test.ts).
 *
 * Patterns must not be global — a `/g` regex carries `lastIndex` between
 * candidates and would match every other one.
 */
export interface RunOutputContract {
  label: string;
  /** All must match for a candidate to qualify. */
  requires: RegExp[];
}

export interface SelectedRunOutput {
  text: string;
  /** Set when the pick is uncertain and the user should eyeball the result. */
  warning: string | null;
  candidateCount: number;
  segmentCount: number;
}

/**
 * The markdown heading that opens a checklist's core group, in both languages
 * the style contract writes (see lib/prompts/test-style.ts).
 *
 * Every phase that authors or reproduces a checklist keys off this one source.
 * It used to be spelled out per contract, and the cost showed: implementation,
 * retest and quickFix kept demanding `## Test Scenarios` long after the style
 * contract had made the core group the thing that matters, so those three
 * phases were contractually satisfied by output the card could not read.
 *
 * `lib/test-progress.ts` owns the HTML-side twin of this pattern — it matches
 * the rendered `<h2>` label rather than the markdown line. The two must keep
 * accepting the same two names; run-output.test.ts asserts it.
 */
const CORE_FLOW_HEADING_SOURCE = String.raw`^##\s*(?:Core\s*flow|Temel\s*ak[ıi][şs])`;

/** Matches the core heading line itself. Never global — see the note above. */
export const CORE_FLOW_HEADING = new RegExp(CORE_FLOW_HEADING_SOURCE, "im");

/** Matches the core heading and everything after it. */
const CORE_FLOW_SECTION = new RegExp(`${CORE_FLOW_HEADING_SOURCE}[\\s\\S]*`, "im");

/**
 * Split a quick-fix response into its two halves. One response carries a
 * summary and a checklist, and the core heading is where the second begins.
 *
 * Written as an index split rather than one lookahead regex on purpose. The
 * obvious `## Quick Fix Summary[\s\S]*?(?=<heading>|$)` needs the `m` flag so
 * the heading's `^` can anchor to a line — and `m` silently redefines `$` as
 * end-of-LINE, so the lazy quantifier stops at the first newline and the
 * summary collapses to its own heading. Splitting on the match index has no
 * such trap.
 */
export function splitQuickFixResponse(responseText: string): {
  summary: string | null;
  checklist: string | null;
} {
  const checklistMatch = responseText.match(CORE_FLOW_SECTION);
  const beforeChecklist = checklistMatch
    ? responseText.slice(0, checklistMatch.index)
    : responseText;
  const summaryMatch = beforeChecklist.match(/## Quick Fix Summary[\s\S]*/i);

  return {
    summary: summaryMatch ? summaryMatch[0] : null,
    checklist: checklistMatch ? checklistMatch[0] : null,
  };
}

export const RUN_OUTPUT_CONTRACTS = {
  planning: {
    label: "plan",
    requires: [/\[COMPLEXITY:/i, /\[PRIORITY:/i],
  },
  implementation: {
    label: "test senaryoları",
    requires: [CORE_FLOW_HEADING],
  },
  retest: {
    label: "test senaryoları",
    requires: [CORE_FLOW_HEADING],
  },
  // Verify reproduces the existing checklist rather than authoring a new one,
  // so the heading it must carry is the core group's, not "Test Scenarios".
  verify: {
    label: "doğrulanmış çeklist",
    requires: [CORE_FLOW_HEADING],
  },
  evaluate: {
    label: "değerlendirme",
    requires: [/^##\s*Summary\s*Verdict/im, /^##\s*Final\s*Score/im],
  },
  // Both headings are required on purpose: accepting a run that has the summary
  // but no tests lets it pass the contract and then fall through to the
  // hardcoded placeholder scenarios in the quick-fix route — silently wrong
  // output dressed up as a clean run.
  quickFix: {
    label: "quick fix",
    requires: [/^##\s*Quick\s*Fix\s*Summary/im, CORE_FLOW_HEADING],
  },
} as const satisfies Record<string, RunOutputContract>;

function longest(texts: string[]): number {
  let best = 0;
  for (let i = 1; i < texts.length; i++) {
    if (texts[i].length > texts[best].length) best = i;
  }
  return best;
}

/**
 * Pick the run's actual product out of everything it said.
 *
 * The CLI's own `result` field is the last assistant message, which is the
 * wrong answer whenever the model speaks again after finishing — a backgrounded
 * command completing re-invokes it, and a one-line "that confirms the number"
 * then overwrites a 16k plan (IDE-280). So: prefer the last candidate that
 * satisfies the phase's contract, fall back to the longest, and say so when the
 * fallback had to be used.
 */
export function selectRunOutput(
  parsed: ParsedRunOutput,
  contract?: RunOutputContract,
): SelectedRunOutput {
  const texts = parsed.candidates.map((c) => c.text);
  const base = {
    candidateCount: texts.length,
    segmentCount: parsed.injectedUserMessages + 1,
  };

  // Nothing to choose between: a run cut short mid-tool-call, or a provider
  // with no collector. Either way `result` is all there is, and using it is
  // exactly what happened before this function existed — not worth a warning.
  if (texts.length === 0) {
    return { text: parsed.result, warning: null, ...base };
  }
  if (texts.length === 1) {
    return { text: texts[0], warning: null, ...base };
  }

  if (contract) {
    for (let i = texts.length - 1; i >= 0; i--) {
      if (contract.requires.every((re) => re.test(texts[i]))) {
        return { text: texts[i], warning: null, ...base };
      }
    }

    const pick = longest(texts);
    return {
      text: texts[pick],
      warning:
        `Koşu çıktısı beklenen ${contract.label} formatında değil. ` +
        `${texts.length} aday metinden en uzunu (${texts[pick].length} karakter) kaydedildi — kontrol edin.`,
      ...base,
    };
  }

  // No contract to check against (retest before its prompt gained one, project
  // narrative). Longest is the best guess, but deviating from "the last thing
  // said" is exactly the case worth flagging.
  const pick = longest(texts);
  if (pick === texts.length - 1) {
    return { text: texts[pick], warning: null, ...base };
  }
  return {
    text: texts[pick],
    warning:
      `Koşu asıl çıktısından sonra tekrar konuştu. ` +
      `${texts.length} aday metinden en uzunu (${texts[pick].length} karakter) kaydedildi — kontrol edin.`,
    ...base,
  };
}

/**
 * Prefix a run warning onto TipTap-ready HTML.
 *
 * Applied *after* marked() + convertToTipTapTaskList() so the checkbox rewrite
 * doesn't have to reason about it.
 */
export function prependWarningHtml(html: string, warning: string): string {
  const escaped = warning
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<blockquote><p>⚠️ ${escaped}</p></blockquote>${html}`;
}

/** Markdown equivalent of `prependWarningHtml`, for file-backed output. */
export function prependWarningMarkdown(markdown: string, warning: string): string {
  return `> ⚠️ ${warning}\n\n${markdown}`;
}
