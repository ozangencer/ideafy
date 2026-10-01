import type { AiPlatform, ProjectMode, Voice, WorkTemplate } from "@/lib/types";
import { DEFAULT_VOICE } from "@/lib/types";
import { stripHtml } from "./utils";
import { detectCardLanguage } from "./test-style";
import { buildVoicePrompt } from "./voice-style";
import { getProviderContextRef } from "@/lib/ai/provider-context-ref";
import { markUntrusted, markUntrustedInline } from "@/lib/untrusted-content";
import { artifactHtmlToMarkdownLinks } from "@/lib/artifact-url";
import { PRIOR_DECISIONS_EVALUATION_RULE } from "./prior-decisions";
import type { ChainCardRef, ChainContext } from "@/lib/chain-order";

/** A card's place in its chain, as the evaluate and ideation routes load it. */
export type PromptChain = ChainContext & { groupCode: string; groupName: string };

/**
 * Shared output schema for idea evaluation. Used by the one-shot evaluate
 * prompt and the interactive ideation prompt so both produce a structurally
 * identical aiOpinion payload.
 */
const EVALUATION_OUTPUT_SCHEMA = `## Summary Verdict
[One sentence: Strong Yes / Yes / Maybe / No / Strong No]

## Related Cards
[Optional — only when an earlier card contradicts this idea, set a precedent for it, already describes the same idea, open work overlaps it or brings in something it relies on, or when the card is in a chain, and only when it would change the verdict or a recommendation. One line per card: displayId, the kind (contradiction, precedent, duplicate, overlap, dependency, predecessor or successor), what it decided or touches, and why it matters here. Chain predecessors and successors are listed in chain order with their status. Leave the whole section out otherwise.]

## Strengths
- Key strengths of the idea

## Concerns
- Main concerns, risks, or issues

## Recommendations
- What to consider before implementing, suggested modifications

## Priority
[PRIORITY: low/medium/high] — reasoning. Be honest, not everything is high priority.

## Complexity
[COMPLEXITY: trivial/low/medium/high/very_high] — assessment.
(trivial = few lines, low = simple, medium = moderate, high = significant, very_high = major)

## Final Score
[X/10] — brief justification`;

/**
 * The "check earlier cards" step for both evaluation prompts. The one-shot
 * Evaluate run never calls get_card, so the ids the MCP tools need are spelled
 * out here. Without a project there is nothing to search, so it drops out.
 */
function buildPriorDecisionsSection(card: { id: string; projectId?: string | null }): string {
  if (!card.projectId) return "";
  return `
## Earlier Decisions
Card id: ${card.id} · projectId: ${card.projectId}

${PRIOR_DECISIONS_EVALUATION_RULE}
`;
}

function chainLine(ref: ChainCardRef): string {
  const name = ref.displayId ? `${ref.displayId} · ${ref.title}` : `${ref.title} (draft, no displayId)`;
  return `${name} — ${ref.status}`;
}

/**
 * The card's chain, spelled out. Evaluate is one-shot and never calls
 * get_card, so its `chain` field would never reach the model; the route loads
 * it and it travels in the prompt instead. Independent of the project: a
 * chain is there to be read whether or not the MCP check can run.
 */
function buildChainSection(chain: PromptChain | null | undefined): string {
  if (!chain) return "";
  const lines = [
    ...chain.predecessors.map((ref, i) => `${i + 1}. ${chainLine(ref)}`),
    `${chain.position}. (this card)`,
    ...chain.successors.map((ref, i) => `${chain.position + i + 1}. ${chainLine(ref)}`),
  ];
  const next = chain.next ? chainLine(chain.next) : "none — every member is completed or withdrawn";
  return `
## Chain
This card is ${chain.position}/${chain.total} in chain ${chain.groupCode} (${chain.groupName}), in chain order:
${lines.join("\n")}
Next open card in the chain: ${next}
`;
}

/**
 * Evaluate prompt for cards entering the Ideation column.
 * Asks Claude to act as a Product Architect and return a structured verdict.
 */
export function buildEvaluatePrompt(
  card: {
    id: string;
    projectId?: string | null;
    title: string;
    description: string;
    externallyAuthored?: boolean;
  },
  narrativePath: string | null | undefined,
  voice: Voice = DEFAULT_VOICE,
  provider: AiPlatform,
  chain?: PromptChain | null,
  mode?: ProjectMode,
): string {
  const external = card.externallyAuthored === true;
  const title = markUntrustedInline(stripHtml(card.title), external);
  const description = markUntrusted(stripHtml(card.description), external);
  const isWork = mode === "work";

  const narrativeRef = narrativePath
    ? `@${narrativePath}`
    : "@docs/product-narrative.md";

  const voicePrompt = buildVoicePrompt(voice, "opinion", { mode });
  const priorDecisions = buildPriorDecisionsSection(card);
  // A Work card has no system to scale or code to keep simple; it is judged on
  // whether it is worth doing and what it takes.
  const lenses = isWork
    ? "worth doing now · scope creep risk · inputs and sources it needs · effort · alignment with the project's goals."
    : "YAGNI · scope creep risk · scalability · technical feasibility · alignment with vision · implementation complexity.";

  return `You are a ${isWork ? "seasoned consultant" : "Product Architect"}. Evaluate this idea — be brutally honest, point out both good and bad.

## Context Files (read if they exist)
- ${narrativeRef} (project vision & scope)
- ${getProviderContextRef(provider)}

## Idea to Evaluate
**Title:** ${title}

**Description:**
${description}

## Evaluation Lenses
${lenses}
${buildChainSection(chain)}${priorDecisions}
${voicePrompt}

## Output Format
Markdown with exactly these sections (Related Cards is the only optional one). Keep every \`##\` heading exactly as written, in English, even when you write the content in another language: the app reads the verdict and the scores from them.

${EVALUATION_OUTPUT_SCHEMA}`;
}

/**
 * Quick fix prompt for cards in the Bugs column. Asks Claude to diagnose,
 * fix, and hand back a short summary + test checklist.
 */
export function buildQuickFixPrompt(
  card: { title: string; description: string; externallyAuthored?: boolean },
  voice: Voice = DEFAULT_VOICE,
  provider: AiPlatform,
  mode?: ProjectMode,
): string {
  const external = card.externallyAuthored === true;
  const title = markUntrustedInline(stripHtml(card.title), external);
  const description = markUntrusted(stripHtml(card.description), external);
  const styleContract = buildVoicePrompt(voice, "tests", {
    language: detectCardLanguage({ title: card.title, description: card.description }),
    mode,
  });
  const summaryVoice = buildVoicePrompt(voice, "quick_fix", { mode });

  return `You are a senior developer. Fix this bug quickly and efficiently.

## Project Context (read before changing code)
- ${getProviderContextRef(provider)}

## Bug Report
${title}

## Description
${description}

## Instructions
1. Analyze the bug description
2. Find the root cause in the codebase
3. Implement the fix
4. Verify the fix works

## Output Requirements
After fixing the bug, provide a brief summary in this format, with the \`## Quick Fix Summary\` heading kept in English whatever language the rest is in:

## Quick Fix Summary
- **Root Cause:** Brief description of what caused the bug
- **Fix Applied:** What was changed to fix it
- **Files Modified:** List of files that were changed

Then the test checklist, opening with its core group: \`## Core flow\` on an English card, \`## Temel akış\` on a Turkish one. Write the steps from what you actually changed — "Bug no longer reproduces" names nothing a person can walk, and the style contract below rejects it. That heading is also what separates the checklist from the summary above, so it must be present and at \`##\` level.

${summaryVoice}

${styleContract}

Focus on fixing the bug efficiently. Do NOT write extensive documentation or plans.`;
}

/**
 * A Work card's Generate run: one autonomous pass that turns the card into a
 * file in the project folder, through the card's template.
 *
 * Quick Fix's sibling for work that is not code, so it keeps Quick Fix's
 * output shape — a summary, then a checklist opening with the core heading —
 * and drops everything about the repo: no worktree, no commit, no tests to
 * run. Whether the run worked is decided by the file it recorded with
 * save_output, not by this text, so the prompt is explicit that the file is
 * the deliverable and the summary only describes it.
 *
 * Files dropped onto the card sit in its description as chips. Those are
 * turned into markdown links before stripping, or the run would see their
 * names without their locations.
 */
export function buildGeneratePrompt(
  card: {
    id: string;
    title: string;
    description: string;
    solutionSummary?: string | null;
    externallyAuthored?: boolean;
  },
  template: WorkTemplate,
  voice: Voice = DEFAULT_VOICE,
): string {
  const external = card.externallyAuthored === true;
  const title = markUntrustedInline(stripHtml(card.title), external);
  const description = markUntrusted(
    stripHtml(artifactHtmlToMarkdownLinks(card.description)),
    external
  );
  const plan = stripHtml(artifactHtmlToMarkdownLinks(card.solutionSummary || ""));
  const language = detectCardLanguage({ title: card.title, description: card.description });
  const styleContract = buildVoicePrompt(voice, "tests", { language, mode: "work" });
  const summaryVoice = buildVoicePrompt(voice, "quick_fix", { mode: "work" });

  const skillStep = template.skill
    ? `Use the \`${template.skill}\` skill to produce it — invoke it by name before writing anything yourself. If the skill is not available in this session, say so in the summary and produce the file without it.`
    : "No skill is assigned; produce it yourself with the tools you have.";
  const preset = template.promptPreset.trim()
    ? `\n## Template Instructions (${template.name})\n${template.promptPreset.trim()}\n`
    : "";
  const planSection = plan ? `\n## Plan\n${markUntrusted(plan, external)}\n` : "";

  return `You are producing a deliverable for a Work card — a document, a deck, a mail draft or a research note, not code. Produce it in one pass.

## Card
${title}

## Description
${description}
${planSection}${preset}
Card ID: ${card.id}

## Instructions
1. Produce one \`${template.outputExt}\` file for this card (template: ${template.name}). ${skillStep}
2. Save it inside the current working directory — the card's project folder. Pick a short descriptive file name. Never write it to ~/Desktop, /tmp or another project: save_output rejects files outside the project folder.
3. Deliver the file with \`mcp__ideafy__save_output\` (card id ${card.id}, the file's path). This is the run's real result: a file that was not recorded with save_output counts as not produced, whatever the summary says. Call it once per file if there is more than one.
4. If a script you run (python3, a converter, a skill's helper) fails, fix the cause and run it again. Do not report a file you have not seen on disk.
5. If save_output answers that the Ideafy app must be updated, stop there and say exactly that in the summary.
6. Mail is drafted, never sent: write the mail as a draft file (.eml or .md) and do not send it through any mail tool, connector or client.

This is a one-shot run: no one is at the keyboard and nothing resumes it. Do not ask questions, do not wait in the background; decide, and note anything you would have asked in the summary.

## Output Requirements
When the file is saved, hand back a short summary in this format, with the \`## Output Summary\` heading kept in English whatever language the rest is in:

## Output Summary
- **File:** the file's name, as recorded with save_output
- **Contents:** what it contains, in two or three sentences
- **Open points:** anything you assumed or could not settle (omit when there is none)

Then a review checklist for the file, opening with its core group: \`## Core flow\` on an English card, \`## Temel akış\` on a Turkish one. Each step names the file to open and what to check in it. That heading is also what separates the checklist from the summary above, so it must be present and at \`##\` level.

${summaryVoice}

${styleContract}`;
}

/**
 * Interactive brainstorming prompt for an ideation session. Unlike
 * `buildEvaluatePrompt`, this is conversational and expects the model to
 * call MCP tools at the end of the session.
 */
export function buildIdeationPrompt(
  card: {
    id: string;
    projectId?: string | null;
    title: string;
    description: string;
    externallyAuthored?: boolean;
  },
  voice: Voice = DEFAULT_VOICE,
  provider: AiPlatform,
  chain?: PromptChain | null,
  mode?: ProjectMode,
): string {
  const external = card.externallyAuthored === true;
  const title = markUntrustedInline(stripHtml(card.title), external);
  const description = markUntrusted(stripHtml(card.description), external);
  const voicePrompt = buildVoicePrompt(voice, "chat", { mode });

  return `You are a Product Strategist. Brainstorm and refine this idea with the user — ask probing questions, challenge assumptions (YAGNI, scope creep), explore alternatives, weigh feasibility and complexity. Be honest but collaborative.

${voicePrompt}

## Project Context (skim before responding)
- ${getProviderContextRef(provider)}

## Idea to Discuss
**Title:** ${title}

**Description:**
${description}

Card ID: ${card.id}
${buildChainSection(chain)}${buildPriorDecisionsSection(card)}
## Available MCP Tools
- mcp__ideafy__get_card · mcp__ideafy__update_card · mcp__ideafy__save_opinion · mcp__ideafy__search_cards · mcp__ideafy__list_open_work

## When the Discussion Ends
Before finishing, do all three:

1. \`mcp__ideafy__update_card\` with \`priority: "low" | "medium" | "high"\` (be honest — not everything is high).
2. \`mcp__ideafy__update_card\` with \`complexity: "trivial" | "low" | "medium" | "high" | "very_high"\`.
3. \`mcp__ideafy__save_opinion\` with \`aiOpinion\` as markdown matching this schema exactly:

${EVALUATION_OUTPUT_SCHEMA}

Do NOT end the session without all three.

Let's start — what would you like to explore about this idea?`;
}
