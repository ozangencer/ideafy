/**
 * Project-level voice contract. Generalizes the IDE-175 test-style pattern to
 * cover every AI surface (plan, tests, opinion, chat, autonomous flows). One
 * voice setting per project drives tone across all of them so a single mental
 * model — `entrepreneur | builder | engineer` — controls how the assistant
 * sounds.
 *
 * Voice changes ONLY tone. Technical content (file paths, change lists,
 * trade-offs) is preserved across all three personas — the entrepreneur voice
 * doesn't strip the content, it just describes it in plainer language.
 */

import type { Voice } from "@/lib/types";
import { DEFAULT_VOICE } from "@/lib/types";
import { buildTestStyleContract, detectCardLanguage } from "./test-style";

export type VoiceSection =
  | "tests"
  | "plan"
  | "opinion"
  | "chat"
  | "autonomous"
  | "solution_summary";

const PERSONA_BASE: Record<Voice, string> = {
  entrepreneur: `## Voice: Entrepreneur

Write like a product person talking to a founder who doesn't read code daily.
- Lead with the user impact, the trade-off, or the "why" — not the file name.
- Plain prose. Avoid \`monospace\` jargon, file:line references, and spec bullets.
- When a technical decision is mentioned, explain it in one sentence of plain
  language ("auth tokens are stored encrypted so a stolen DB dump can't be
  replayed"), not as a list of API contracts.
- Never strip technical content that the user needs — describe it, don't cite
  it. If a plan changes three files, name what changes ("the login flow, the
  session check, and the logout cleanup"), not the file paths.`,

  builder: `## Voice: Builder

Write for a solo founder who codes — fluent in technical terms but allergic to
spec verbosity.
- Plain technical sentences, not bullet specs. "I added an expiry check to the
  auth callback because the old token was reused after sign-out."
- Name files and changes when relevant, but skip line numbers and snippets
  unless the change is non-obvious.
- One short paragraph per change beats five terse bullets. Group by
  feature area, not by file.
- Trade-offs and edge cases get a single sentence each, not a section.`,

  engineer: `## Voice: Engineer

Write for an SWE reviewing the change in passing — terse, structured, dense.
- Spec-style. Bullets, file:line references, code snippets when they clarify.
- Surface trade-offs explicitly ("chose A over B because of N+1 risk").
- Group by file, then by symbol. Use a Changed Files table when more than two
  files move.
- Skip rationale that's obvious from the diff. Don't restate the task.`,
};

const SECTION_ACCENTS: Record<VoiceSection, Partial<Record<Voice, string>>> = {
  tests: {
    // Tests get the IDE-175 STYLE CONTRACT regardless of voice — the
    // manual-tester format is non-negotiable. Voice only colors the prose
    // around each step.
    entrepreneur: `\n\n### Tests-tab accent\nKeep step descriptions in plain language. Reference UI labels users actually see.`,
    builder: `\n\n### Tests-tab accent\nMix UI labels with the occasional technical hint when it helps reproduction. Still imperative steps, not assertions.`,
    engineer: `\n\n### Tests-tab accent\nAfter each manual scenario, you may add the related code path or function name in parentheses if it speeds debugging — but the step itself must still read as a manual instruction.`,
  },

  plan: {
    entrepreneur: `\n\n### Plan accent\nWrite the plan as: what we're building, why, who feels it, what's the risk. Sequence the work in plain language. List the files that will change, but describe what each does in one human sentence.`,
    builder: `\n\n### Plan accent\nPlan = ordered prose paragraphs per step. Each step names the file(s) that change and what changes, in plain English. Add a "Files" line at the end with the paths. No spec bullets unless the step has more than ~5 sub-changes.`,
    engineer: `\n\n### Plan accent\nPlan = numbered steps, each with file:line scope, function/symbol names, and a 1-line trade-off note. End with a Changed Files table (\`| File | Change |\`).`,
  },

  opinion: {
    entrepreneur: `\n\n### Opinion accent\nFocus the verdict on user impact, scope creep, MVP fit, and what the user will or won't notice. Surface technical risks in plain language. Skip refactor opportunities and code-borrowed terminology.`,
    builder: `\n\n### Opinion accent\nBalance product and technical lenses. Name the key risks (race conditions, schema drift, etc.) but keep them as one-sentence callouts, not deep dives. Mention rough complexity in plain words.`,
    engineer: `\n\n### Opinion accent\nLead with technical risk: race conditions, n+1, schema drift, API contract breaks, perf cliffs, refactor opportunities. Mention testability and dependency cost. Product framing is secondary.`,
  },

  chat: {
    entrepreneur: `\n\n### Chat accent\nDefault tone: plain conversational, no jargon. The user can always ask "give me the technical version" if they want one.`,
    builder: `\n\n### Chat accent\nDefault tone: technical-fluent conversation. Mention files and changes naturally; skip spec bullets unless the user asks.`,
    engineer: `\n\n### Chat accent\nDefault tone: terse and structured. Bullets, file refs, code blocks where they help. Skip pleasantries.`,
  },

  autonomous: {
    entrepreneur: `\n\n### Autonomous-flow accent\nThe summary you hand back at the end should be plain-language. List what changed in human terms; the user will read this without opening the diff.`,
    builder: `\n\n### Autonomous-flow accent\nHand back a short prose summary plus a Files line. Each file gets one sentence on what changed.`,
    engineer: `\n\n### Autonomous-flow accent\nHand back a Changed Files table, root-cause one-liner, and trade-off note. Skip narration.`,
  },

  solution_summary: {
    entrepreneur: `\n\n### Solution-summary accent\nNarrate the fix as a story: what was wrong, what we did, what the user will notice. Files mentioned by name, not path.`,
    builder: `\n\n### Solution-summary accent\nProse paragraphs grouped by feature area. Mention file paths inline. Add a Files table at the end if more than 3 files moved.`,
    engineer: `\n\n### Solution-summary accent\nRoot cause → architecture context → step-by-step changes with snippets → Changed Files table → notes/caveats. Standard SWE write-up.`,
  },
};

/**
 * Build the voice contract block to inject into a system prompt. Returns the
 * persona base + section accent. For the `tests` section, the IDE-175
 * test-style contract is included verbatim before the voice accent so the
 * manual-tester format always wins.
 */
export function buildVoicePrompt(
  voice: Voice = DEFAULT_VOICE,
  section: VoiceSection,
  opts: { language?: "tr" | "en" } = {},
): string {
  const persona = PERSONA_BASE[voice] ?? PERSONA_BASE[DEFAULT_VOICE];
  const accent = SECTION_ACCENTS[section]?.[voice] ?? "";

  if (section === "tests") {
    const styleContract = buildTestStyleContract({ language: opts.language });
    return `${styleContract}\n\n${persona}${accent}`;
  }

  return `${persona}${accent}`;
}

/**
 * Convenience: detect the card's language and return the full voice prompt
 * for the `tests` section in one call. Mirrors test-style's
 * buildTestStyleContractForCard.
 */
export function buildVoicePromptForCard(
  voice: Voice | undefined,
  section: VoiceSection,
  card: { title?: string | null; description?: string | null },
): string {
  return buildVoicePrompt(voice ?? DEFAULT_VOICE, section, {
    language: detectCardLanguage(card),
  });
}
