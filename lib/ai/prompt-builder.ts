/**
 * Shared prompt-building utilities for AI chat.
 * Used by both local chat-stream and remote-job-runner.
 */

import type { AiPlatform, SectionType, ConversationMessage, ProjectMode, Voice } from "@/lib/types";
import { markUntrusted, markUntrustedInline } from "@/lib/untrusted-content";
import { DEFAULT_VOICE } from "@/lib/types";
import { testScenariosToMarkdown } from "@/lib/markdown";
import { detectCardLanguage } from "@/lib/prompts/test-style";
import { buildVoicePrompt } from "@/lib/prompts/voice-style";
import { AI_OPINION_PLANNING_RULE } from "@/lib/prompts/opinion";
import { PRIOR_DECISIONS_RULE } from "@/lib/prompts/prior-decisions";
import { getProviderContextRef } from "@/lib/ai/provider-context-ref";
import { APPLY_OPEN_MARKER, APPLY_CLOSE_MARKER } from "@/lib/apply-content";
import { artifactHtmlToMarkdownLinks } from "@/lib/artifact-url";

// Card context info
export interface CardContext {
  uuid: string;
  displayId: string;
  title: string;
  projectName: string;
  sectionContent: string;
  narrativeContent?: string;
  status: string;
  description?: string;
  solutionSummary?: string;
  testScenarios?: string;
  /**
   * Stripped text of the card's AI Opinion. The Solution chat plans on top of
   * it, since it is the evaluation the user already accepted.
   */
  aiOpinion?: string;
  /**
   * Project-level voice for AI tone. Defaults to 'builder' when not provided
   * (legacy callers, missing project, etc.).
   */
  voice?: Voice;
  /**
   * The card's project mode. A Work card has no code, branch or dev server, so
   * its prompts talk about an output in the project folder instead, and the
   * voice collapses to the single Work tone. Unset reads as "development".
   */
  mode?: ProjectMode;
  /**
   * Raw Tiptap HTML for testScenarios. When present, the builder renders
   * scenarios as markdown with [x]/[ ] preserved so the AI sees checkbox
   * state. Falls back to `testScenarios` (stripped text) when absent.
   */
  testScenariosHtml?: string;
  /**
   * Active AI provider for this card. Names the project's instruction file in
   * the provider's own terms (CLAUDE.md / AGENTS.md / GEMINI.md). Optional:
   * callers that cannot resolve a provider simply get no such line.
   */
  provider?: AiPlatform;
  /**
   * Set when this card's text came from another member's pool card. The
   * tests-section path below runs with tool permissions disabled, so the
   * card body is fenced and labelled as data before it reaches the model.
   * Never set in the solo edition — there is no pool there.
   */
  externallyAuthored?: boolean;
  /**
   * The card's permanent folder (`~/.ideafy/images/<uuid>`). Approved
   * artifacts are saved here and linked from the applied content. Callers
   * without file access (remote runner) leave it unset and get no rule.
   */
  artifactDir?: string;
}

// Get allowed tools for non-test sections (test section uses --dangerously-skip-permissions)
// Lives in its own module so the mcp-server tests can load it without the
// rest of the prompt builder's dependency tree.
export { getAllowedTools } from "./allowed-tools";

// Build card context string
export function buildCardContext(ctx: CardContext): string {
  const providerContextLine = ctx.provider
    ? `\nPROJECT CONTEXT FILES: ${getProviderContextRef(ctx.provider)}.\nGround your analysis in these files when relevant.\n`
    : "";

  return `
CURRENT CARD CONTEXT:
- Card ID: ${ctx.displayId}
- Card UUID: ${ctx.uuid}
- Title: "${markUntrustedInline(ctx.title, ctx.externallyAuthored === true)}"
- Project: ${ctx.projectName || "(none)"}
${providerContextLine}
IMPORTANT: When updating this card, use the UUID "${ctx.uuid}" directly. Do NOT search for the card by display ID.
`;
}

// Long enough for a full evaluation; a runaway opinion still cannot crowd out
// the rest of the prompt.
const MAX_OPINION_CONTEXT = 6000;

// The accepted AI Opinion, handed to the Solution chat so the plan starts from
// its recommendations instead of re-deriving an approach from the description.
function buildOpinionContext(ctx: CardContext): string {
  const opinion = ctx.aiOpinion?.trim();
  if (!opinion) return "";
  const clipped =
    opinion.length > MAX_OPINION_CONTEXT
      ? `${opinion.slice(0, MAX_OPINION_CONTEXT)}\n[... opinion truncated ...]`
      : opinion;
  return `
AI Opinion (the accepted evaluation — base the plan on its recommendations):
${markUntrusted(clipped, ctx.externallyAuthored === true)}

${AI_OPINION_PLANNING_RULE}
`;
}

// Build section behavior context based on section type and card status
export function buildSectionBehaviorContext(ctx: CardContext, sectionType: string): string {
  const isWork = ctx.mode === "work";
  if (sectionType === "tests" && ["progress", "test", "completed"].includes(ctx.status)) {
    const actionBullets = isWork
      ? `- If the user asks you to change the output, change it directly in the project folder
- If the user asks you to produce something, produce it and leave it in the project folder
- Only ask clarifying questions if the request is genuinely ambiguous
- Do NOT respond with "here's a plan" — actually do the work
- Record every file you produce or replace with save_output`
      : `- If the user asks you to fix something, fix it directly
- If the user asks you to implement something, implement it
- Only ask clarifying questions if the request is genuinely ambiguous
- Do NOT respond with "here's a plan" — actually do the work
- You have access to Bash, Grep, and Glob tools in addition to Read, Edit, and Write`;
    let actionContext = `

## Action Mode
This card is currently in "${ctx.status}" status. The user expects you to TAKE ACTION, not just suggest or plan.
${actionBullets}

## Test Scenarios: append by default, delete only when asked
Writes to the checklist are append-only unless the user asks for a removal in this turn.
- Default: keep every existing scenario, preserve the EXACT markdown format (headings, checkbox syntax, grouping), and keep checked items checked — [x] MUST stay [x]. Add new cases at the end.
- A save_tests call that drops an existing item is rejected by the server, so on a normal append always send ALL existing scenarios plus your additions.
- When the user explicitly asks you to remove scenarios — "forget those", "I don't want the extra section", "drop the last three", "undo what you just added" — call save_tests with \`allowDeletion: true\` and the exact list the card should end up with. That payload is a literal replacement including checkbox state, so copy every surviving item verbatim, [x] and [ ] as they stand now.
- Never pass allowDeletion on a turn where the user did not ask for a removal.
- If the user wants the list emptied completely, say so plainly and let them clear it in the Tests tab — save_tests will not write an empty checklist.`;

    const external = ctx.externallyAuthored === true;
    if (ctx.description) {
      actionContext += `\n\nCard Description: ${markUntrusted(ctx.description, external)}`;
    }
    if (ctx.solutionSummary) {
      actionContext += `\n${isWork ? "Plan" : "Implementation Plan"}: ${markUntrusted(ctx.solutionSummary, external)}`;
    }
    if (ctx.testScenarios) {
      // Feed markdown (with [x]/[ ]) instead of stripped text so the AI can
      // see which scenarios are already checked and must stay [x] on rewrite.
      const scenariosMd = testScenariosToMarkdown(ctx.testScenariosHtml || "") || ctx.testScenarios;
      actionContext += `\n${isWork ? "Review Checklist" : "Test Scenarios"} (preserve checkbox state verbatim when regenerating):\n${scenariosMd}`;
    }

    return actionContext;
  }

  const fieldName = sectionType === "detail" ? "description" : sectionType === "opinion" ? "AI opinion/evaluation" : "solution plan";
  if (isWork) {
    return `

## IMPORTANT: No Changes to the Output
You are in the "${sectionType}" section. In this section you can ONLY:
- Discuss, analyze, and help improve the ${fieldName} for this card
- Update the card field using the appropriate MCP tool (update_card, save_plan, save_opinion)
- Read files in the project folder for context if needed

You MUST NOT create, edit, or delete files in the project folder. If the user asks you to produce or change the output, politely explain that the output can only be changed from the "Tests" tab chat. Redirect them there.
You MUST NOT edit the review checklist from this section. If the user asks to add/remove/change checklist items, tell them to switch to the "Tests" tab chat and do not call save_tests from here.`;
  }

  return `

## IMPORTANT: No Code Changes Allowed
You are in the "${sectionType}" section. In this section you can ONLY:
- Discuss, analyze, and help improve the ${fieldName} for this card
- Update the card field using the appropriate MCP tool (update_card, save_plan, save_opinion)
- Read files for context if needed

You MUST NOT edit, write, or modify any code files. If the user asks you to make code changes, politely explain that code changes can only be made from the "Tests" tab chat. Redirect them there.
You MUST NOT edit test scenarios from this section. If the user asks to add/remove/change tests, tell them to switch to the "Tests" tab chat and do not call save_tests from here.`;
}

// Tells the model to fence card-bound content so Apply can skip the narration
// around it. The markers are HTML comments: the chat renderer drops them and
// lib/apply-content.ts reads them.
function buildApplyMarkerContext(section: SectionType): string {
  return `

## Marking content for Apply
${section === "tests"
  ? "Whenever your reply proposes scenarios for the user to apply — including a turn where you also called save_tests to record results — wrap"
  : "When your reply contains content meant for this card field, wrap"} exactly that content between these two lines:
${APPLY_OPEN_MARKER}
${APPLY_CLOSE_MARKER}
Explanations, reasoning, status narration ("reading the opinion…") and pointers like "apply this with Replace" go outside the block — the Apply buttons take only what is inside it. Use one block per reply. Skip the block when you are only asking a question or chatting.`;
}

// Every file linked in chat must sit where open-artifact will open it — the
// card folder. Scratch output goes to `scratch/`, which the daily sweep
// clears once the card has been completed for a week (IDE-394).
export function buildFileLinkRule(ctx: CardContext): string {
  if (!ctx.artifactDir) return "";
  return `

## Files you link
Write every file you link in this chat under \`${ctx.artifactDir}/\`. Scratch output — intermediate results, comparisons, logs — goes under \`${ctx.artifactDir}/scratch/\`. Link a file with its absolute path as a markdown link: \`[name](file://${ctx.artifactDir}/scratch/file-name.txt)\`. Encode spaces as %20. Never link a file you wrote outside this folder (\`/tmp\` included) — the card refuses to open it. If you must mention such a path, write it as plain text, without backticks.`;
}

// Approved artifacts must land on the card as a link the user can click;
// otherwise the file only lives in chat history and a temp folder.
export function buildArtifactLinkRule(ctx: CardContext, section: SectionType): string {
  if (!ctx.artifactDir) return "";
  return `${buildFileLinkRule(ctx)}

## Artifacts (mockups, images, documents)
When the user approves an artifact you produced for this card — an image, a document — save the file under \`${ctx.artifactDir}/\` and make the FIRST line inside your apply block a markdown link to it with its absolute path: \`[mockup name](file://${ctx.artifactDir}/file-name.html)\`. Encode spaces as %20. The card shows that link as a clickable chip that opens the file; without it the artifact is lost to the card. A claude.ai artifact is linked with its normal https:// URL instead. HTML mockups follow the next section instead.${buildMockupRule(ctx, section)}`;
}

// Mockups travel as a fenced block that chat-stream saves and swaps for a
// link (lib/artifact-fence.ts), so no provider needs write access for them
// (IDE-397). The tab follows the phase: options on Opinion while the idea is
// still being weighed, the reference on Solution once it is planned.
function buildMockupRule(ctx: CardContext, section: SectionType): string {
  const target: SectionType = ctx.status === "ideation" ? "opinion" : "solution";
  const tab = target === "opinion" ? "AI Opinion" : "Solution";
  const placement = section === target
    ? `This chat is that tab: make the block the first item inside your apply block, followed by a \`## Mockup\` heading and 3-6 sentences — which surfaces it shows, what the controls do, and what to watch for when it is turned into code.`
    : `This chat is not that tab: still produce the block, but outside your apply block, and tell the user to have the ${tab} chat link the saved file, which lands it on the card without drawing it again.`;
  return `

## Mockups
Produce a mockup only when the user asks for one — a mockup, prototype or artifact — in this chat or in the card description. Never add one on your own.
Do not write the mockup file yourself. Put the whole file in your reply as one fenced block whose info string names the file:
\`\`\`html artifact="short-name.html"
<!doctype html>…
\`\`\`
Ideafy saves the block into the card folder and replaces it with a link, so the code never shows in the chat. Use \`svg\` and a \`.svg\` name for a lone SVG; no other formats.
On this card a mockup belongs on the ${tab} tab. ${placement}
Keep it economical: one self-contained file, no CDN, no framework, colours and tokens taken from the project's real code. Draw only the surfaces that change the decision, and add interaction only when asked. If it would grow past about 30 KB, ask first.
A mockup is a tool for the decision, not the spec: once the code exists, the code wins.`;
}

// Each chat turn is its own `claude -p`: background work it starts is stopped
// when the turn ends, and the promised notification never arrives (IDE-392).
// Unlike the one-shot run rule the user is here, so asking them stays allowed.
const CHAT_TURN_RULE = `

## Finish your work inside this turn
This turn ends when your reply ends, and anything you started in the background is stopped then — no notification will ever reach you. Do not use \`run_in_background\`, and do not end the turn with "I'll report when it finishes". If you need parallel work, start several Agents in the same message in the foreground and wait for all of their results.`;

// Shared MCP tool usage instructions
export function buildToolUsageContext(section: SectionType, mode?: ProjectMode): string {
  const isWork = mode === "work";
  return `

## Available MCP Tools
${section === "tests"
  ? `You have access to these MCP tools for updating this card:
${isWork
  ? `- save_tests: Save the review checklist (markdown with checkboxes) and move card to In Review
- save_output: Record a file the work produced in the project folder (does not move the card)`
  : "- save_tests: Save test scenarios (markdown with checkboxes) and move card to Human Test"}
- update_card: Update card fields (title, status, complexity, priority). Do NOT use this for testScenarios — always use save_tests instead, so existing checkbox states are preserved.`
  : `Content writes for this section happen through the chat-UI Apply buttons (Append / Replace) — not through MCP tools. You do not have a write tool for this field; just respond with your content as markdown and let the user click Apply.`}

## CRITICAL: Persisting Content
${section === "tests"
  ? `Do NOT call save_tests on every turn. Most turns in this tab are conversation — answering a question, explaining why a test failed, ${isWork ? "changing the output" : "making a code change"} — and they should end with a plain reply and nothing written to the card.

Call save_tests only when:
- the user explicitly asks you to add, rewrite, or save scenarios, or
- the user asks you to remove scenarios (then pass allowDeletion: true — see the rules above), or
- a scenario's result becomes known: they report one as passing, or they ask you to run the tests and you verify one yourself. Results are the point of this checklist, so record them without waiting to be asked twice. Check only the boxes actually confirmed; leave failures and anything you could not verify unchecked, and say which is which. Send the full checklist with every existing item's state preserved.

Otherwise, when you have scenarios worth proposing, just write them in your reply as markdown checkboxes and stop. The chat UI puts Append / Replace buttons under your message and the user decides whether they land on the card. Replace is also how they wipe scenarios you proposed and they didn't want — so a reply that skips save_tests keeps that escape hatch open. Calling save_tests hides those buttons unless the reply also carries an apply block.`
  : `When you produce substantive content for a card field, you MUST save it using the appropriate MCP tool.
Do NOT just respond with text — persist it to the card so it appears in the UI.
This includes when you agree with, refine, or expand on the user's ideas — always save the resulting content.
Only skip saving for pure clarifying questions or very brief acknowledgments without new content.`}
${section === "solution" ? `
Do NOT call save_plan. The user reviews your plan and clicks Append or Replace via the Apply buttons in the chat UI; clicking Apply also moves the card to In Progress automatically when appropriate. If you call save_plan you will silently overwrite their existing solution — that is the destructive bug Apply was built to prevent. Respond with your plan as normal markdown text and let the user click Apply.
Do NOT automatically generate test scenarios when producing a plan. Only generate tests if the user explicitly asks for it.` : ""}${section === "detail" ? `
Do NOT call update_card to write the description. The user reviews your reply and decides whether to Append or Replace via the Apply buttons in the chat UI. If you call update_card with a description, you will silently overwrite their existing content — that is the destructive bug Apply was built to prevent. Respond with your refined content as normal markdown text and let the user click Apply.` : ""}${section === "opinion" ? `
Do NOT call save_opinion. The user reviews your evaluation and clicks Append or Replace via the Apply buttons in the chat UI; the verdict is parsed from your "## Summary Verdict (...)" line automatically when Apply is clicked. If you call save_opinion you will silently overwrite their existing opinion — that is the destructive bug Apply was built to prevent. Respond with your evaluation as normal markdown (include the Summary Verdict / Strengths / Concerns / Recommendations / Priority / Final Score sections) and let the user click Apply.` : ""}${section === "tests" ? `
On the turns where you do call save_tests, send markdown checkbox format and NEVER use update_card for testScenarios — it bypasses checkbox state preservation. Send the full checklist the card should end up with: existing items plus your additions on an append, or the surviving items only when the user asked for a removal and you pass allowDeletion. save_tests merges checkbox states automatically on appends.
After ${isWork ? "changing the output" : "a code change"}, do not reach for save_tests reflexively. Describe what you changed, propose any new scenarios as checkboxes in your reply, and let the user apply them.` : ""}${buildApplyMarkerContext(section)}${CHAT_TURN_RULE}`;
}

// Section-specific system prompts
export const SECTION_SYSTEM_PROMPTS: Record<SectionType, (ctx: CardContext) => string> = {
  detail: (ctx) => {
    const voice = buildVoicePrompt(ctx.voice ?? DEFAULT_VOICE, "chat", { mode: ctx.mode });
    return `You are helping improve ${ctx.mode === "work" ? "the description of a work task" : "a development task description"}.
${buildCardContext(ctx)}
Current description: ${ctx.sectionContent || "(empty)"}

Provide helpful suggestions, clarifications, or improvements. Be concise and practical.

${voice}${buildSectionBehaviorContext(ctx, "detail")}${buildToolUsageContext("detail", ctx.mode)}${buildArtifactLinkRule(ctx, "detail")}`;
  },

  opinion: (ctx) => {
    const isWork = ctx.mode === "work";
    const voice = buildVoicePrompt(ctx.voice ?? DEFAULT_VOICE, "opinion", { mode: ctx.mode });
    let prompt = `${isWork ? "You are a seasoned consultant evaluating a work task." : "You are a senior software architect evaluating a development task."}
${buildCardContext(ctx)}
Current opinion: ${ctx.sectionContent || "(none)"}`;

    if (ctx.narrativeContent) {
      prompt += `

## Product Narrative (Brand Context)
Use this product narrative to understand the project vision, goals, and constraints when evaluating:

${ctx.narrativeContent}

---`;
    }

    prompt += `

${isWork
  ? "Assess what the work needs, where it could go wrong, suggest approaches, and gauge its size."
  : "Provide technical analysis, identify potential challenges, suggest approaches, and assess complexity."} Be direct and constructive.

${voice}${buildSectionBehaviorContext(ctx, "opinion")}${buildToolUsageContext("opinion", ctx.mode)}${buildArtifactLinkRule(ctx, "opinion")}`;
    return prompt;
  },

  solution: (ctx) => {
    const isWork = ctx.mode === "work";
    const voice = buildVoicePrompt(ctx.voice ?? DEFAULT_VOICE, "plan", { mode: ctx.mode });
    return `${isWork ? "You are helping plan a work task." : "You are helping plan the implementation of a development task."}
${buildCardContext(ctx)}${buildOpinionContext(ctx)}
${PRIOR_DECISIONS_RULE}

Current solution plan: ${ctx.sectionContent || "(none)"}

${isWork
  ? "Help shape the approach, name the inputs and sources it needs, and structure the work."
  : "Help refine the implementation approach, suggest patterns, identify dependencies, and structure the work."} Be specific and actionable.

${voice}${buildSectionBehaviorContext(ctx, "solution")}${buildToolUsageContext("solution", ctx.mode)}${buildArtifactLinkRule(ctx, "solution")}`;
  },

  tests: (ctx) => {
    const lang = detectCardLanguage({ title: ctx.title, description: ctx.description });
    const isWork = ctx.mode === "work";
    const voice = buildVoicePrompt(ctx.voice ?? DEFAULT_VOICE, "tests", { language: lang, mode: ctx.mode });
    // Prefer markdown with [x]/[ ] so the AI can see which items are already
    // checked; fall back to the stripped sectionContent for empty/legacy cases.
    const currentTests =
      testScenariosToMarkdown(ctx.testScenariosHtml || "") ||
      ctx.sectionContent ||
      "(none)";
    return `${isWork
  ? "You are a reviewer walking the user through checking this card's output step by step. Your goal is to produce a review checklist they can actually follow, not a list of claims."
  : "You are a manual tester walking a solo founder through this feature step by step. Your goal is to produce scenarios they can actually follow, not a spec of assertions."}
${buildCardContext(ctx)}
Current test scenarios:
${currentTests}

Lead with the core flow — the handful of ${isWork ? "checks that prove the output is right" : "steps that prove the feature works"} at all. Add edge cases and error conditions only where they catch something the core flow cannot; a checklist nobody runs is worse than a short one. Use checkbox format: \`- [ ] Step description\`.

Scope what you write to what the user actually asked about. If they asked about one flow, cover that flow — do not regenerate or expand the whole checklist. A question deserves an answer, not a fresh batch of scenarios.

${voice}${buildSectionBehaviorContext(ctx, "tests")}${buildToolUsageContext("tests", ctx.mode)}${buildFileLinkRule(ctx)}`;
  },
};

// Strip HTML tags for cleaner prompts
export function stripHtml(html: string): string {
  if (!html) return "";
  // Artifact chips keep their file location as a markdown link, so the next
  // chat turn still knows where the approved file lives.
  return artifactHtmlToMarkdownLinks(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// Build conversation context from history
// Last 4 messages (2 turns) sent in full, older messages truncated to save tokens
// Optional imageExtractor callback handles base64→file conversion (requires fs, so kept out of this module)
export function buildConversationContext(
  messages: ConversationMessage[],
  imageExtractor?: (content: string, msgIndex: number) => { cleanContent: string; imageRefs: string },
): string {
  if (messages.length === 0) return "";

  const RECENT_COUNT = 4;
  const OLDER_MAX_CHARS = 200;

  const recent = messages.slice(-RECENT_COUNT);
  const older = messages.slice(-10, -RECENT_COUNT);
  let allImageRefs = "";

  const processContent = (content: string, msgIndex: number): string => {
    if (imageExtractor && content.includes("data:image/")) {
      const { cleanContent, imageRefs } = imageExtractor(content, msgIndex);
      if (imageRefs) allImageRefs += (allImageRefs ? "\n" : "") + imageRefs;
      return cleanContent;
    }
    return content;
  };

  const truncate = (text: string) =>
    text.length <= OLDER_MAX_CHARS
      ? text
      : text.slice(0, OLDER_MAX_CHARS) + "...";

  const parts: string[] = [];

  for (let i = 0; i < older.length; i++) {
    const msg = older[i];
    const role = msg.role === "user" ? "User" : "Assistant";
    const content = processContent(msg.content, i);
    parts.push(`${role}: ${truncate(content)}`);
  }
  for (let i = 0; i < recent.length; i++) {
    const msg = recent[i];
    const role = msg.role === "user" ? "User" : "Assistant";
    const content = processContent(msg.content, older.length + i);
    parts.push(`${role}: ${content}`);
  }

  let result = `\n\nPrevious conversation:\n${parts.join("\n\n")}`;

  if (allImageRefs) {
    result += `\n\n${allImageRefs}`;
  }

  return result;
}
