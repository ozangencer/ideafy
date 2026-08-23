/**
 * Shared prompt-building utilities for AI chat.
 * Used by both local chat-stream and remote-job-runner.
 */

import type { AiPlatform, SectionType, ConversationMessage, Voice } from "@/lib/types";
import { markUntrusted, markUntrustedInline } from "@/lib/untrusted-content";
import { DEFAULT_VOICE } from "@/lib/types";
import { testScenariosToMarkdown } from "@/lib/markdown";
import { detectCardLanguage } from "@/lib/prompts/test-style";
import { buildVoicePrompt } from "@/lib/prompts/voice-style";
import { getProviderContextRef } from "@/lib/ai/provider-context-ref";

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
   * Project-level voice for AI tone. Defaults to 'builder' when not provided
   * (legacy callers, missing project, etc.).
   */
  voice?: Voice;
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
}

// Get allowed tools for non-test sections (test section uses --dangerously-skip-permissions)
export function getAllowedTools(
  section: SectionType,
  mentions?: Array<{ type: string; id: string; label: string }>
): string[] {
  const base = ["Read", "Grep", "Glob"];

  // Add MCP tool patterns for referenced MCP mentions
  if (mentions?.length) {
    for (const m of mentions) {
      if (m.type === "mcp" || m.type === "plugin") {
        if (section === "tests") {
          base.push(`mcp__${m.id}__*`);
          continue;
        }

        // Outside the Tests tab, never expose save_tests/move_card/etc.
        // Restrict the model to read-only inspection plus the field-appropriate
        // persistence tools for the active section.
        base.push(`mcp__${m.id}__get_card`);
        // Detail/Solution/Opinion intentionally exclude their write tools
        // (update_card / save_plan / save_opinion). All content writes go
        // through the chat-UI Apply buttons (append/replace) so the user
        // controls when existing content is overwritten. Letting the model
        // call write tools from here re-introduces the silent-overwrite bug.
        // Status transition (→ in progress on Solution apply) and verdict
        // parsing (on Opinion apply) are handled by the apply-message route.
      }
    }
  }

  return Array.from(new Set(base));
}

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

// Build section behavior context based on section type and card status
export function buildSectionBehaviorContext(ctx: CardContext, sectionType: string): string {
  if (sectionType === "tests" && ["progress", "test", "completed"].includes(ctx.status)) {
    let actionContext = `

## Action Mode
This card is currently in "${ctx.status}" status. The user expects you to TAKE ACTION, not just suggest or plan.
- If the user asks you to fix something, fix it directly
- If the user asks you to implement something, implement it
- Only ask clarifying questions if the request is genuinely ambiguous
- Do NOT respond with "here's a plan" — actually do the work
- You have access to Bash, Grep, and Glob tools in addition to Read, Edit, and Write

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
      actionContext += `\nImplementation Plan: ${markUntrusted(ctx.solutionSummary, external)}`;
    }
    if (ctx.testScenarios) {
      // Feed markdown (with [x]/[ ]) instead of stripped text so the AI can
      // see which scenarios are already checked and must stay [x] on rewrite.
      const scenariosMd = testScenariosToMarkdown(ctx.testScenariosHtml || "") || ctx.testScenarios;
      actionContext += `\nTest Scenarios (preserve checkbox state verbatim when regenerating):\n${scenariosMd}`;
    }

    return actionContext;
  }

  return `

## IMPORTANT: No Code Changes Allowed
You are in the "${sectionType}" section. In this section you can ONLY:
- Discuss, analyze, and help improve the ${sectionType === "detail" ? "description" : sectionType === "opinion" ? "AI opinion/evaluation" : "solution plan"} for this card
- Update the card field using the appropriate MCP tool (update_card, save_plan, save_opinion)
- Read files for context if needed

You MUST NOT edit, write, or modify any code files. If the user asks you to make code changes, politely explain that code changes can only be made from the "Tests" tab chat. Redirect them there.
You MUST NOT edit test scenarios from this section. If the user asks to add/remove/change tests, tell them to switch to the "Tests" tab chat and do not call save_tests from here.`;
}

// Shared MCP tool usage instructions
export function buildToolUsageContext(section: SectionType): string {
  return `

## Available MCP Tools
${section === "tests"
  ? `You have access to these MCP tools for updating this card:
- save_tests: Save test scenarios (markdown with checkboxes) and move card to Human Test
- update_card: Update card fields (title, status, complexity, priority). Do NOT use this for testScenarios — always use save_tests instead, so existing checkbox states are preserved.`
  : `Content writes for this section happen through the chat-UI Apply buttons (Append / Replace) — not through MCP tools. You do not have a write tool for this field; just respond with your content as markdown and let the user click Apply.`}

## CRITICAL: Persisting Content
${section === "tests"
  ? `Do NOT call save_tests on every turn. Most turns in this tab are conversation — answering a question, explaining why a test failed, making a code change — and they should end with a plain reply and nothing written to the card.

Call save_tests only when:
- the user explicitly asks you to add, rewrite, or save scenarios, or
- the user asks you to remove scenarios (then pass allowDeletion: true — see the rules above), or
- a scenario's result becomes known: they report one as passing, or they ask you to run the tests and you verify one yourself. Results are the point of this checklist, so record them without waiting to be asked twice. Check only the boxes actually confirmed; leave failures and anything you could not verify unchecked, and say which is which. Send the full checklist with every existing item's state preserved.

Otherwise, when you have scenarios worth proposing, just write them in your reply as markdown checkboxes and stop. The chat UI puts Append / Replace buttons under your message and the user decides whether they land on the card. Replace is also how they wipe scenarios you proposed and they didn't want — so a reply that skips save_tests keeps that escape hatch open. Calling save_tests hides those buttons.`
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
After a code change, do not reach for save_tests reflexively. Describe what you changed, propose any new scenarios as checkboxes in your reply, and let the user apply them.` : ""}`;
}

// Section-specific system prompts
export const SECTION_SYSTEM_PROMPTS: Record<SectionType, (ctx: CardContext) => string> = {
  detail: (ctx) => {
    const voice = buildVoicePrompt(ctx.voice ?? DEFAULT_VOICE, "chat");
    return `You are helping improve a development task description.
${buildCardContext(ctx)}
Current description: ${ctx.sectionContent || "(empty)"}

Provide helpful suggestions, clarifications, or improvements. Be concise and practical.

${voice}${buildSectionBehaviorContext(ctx, "detail")}${buildToolUsageContext("detail")}`;
  },

  opinion: (ctx) => {
    const voice = buildVoicePrompt(ctx.voice ?? DEFAULT_VOICE, "opinion");
    let prompt = `You are a senior software architect evaluating a development task.
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

Provide technical analysis, identify potential challenges, suggest approaches, and assess complexity. Be direct and constructive.

${voice}${buildSectionBehaviorContext(ctx, "opinion")}${buildToolUsageContext("opinion")}`;
    return prompt;
  },

  solution: (ctx) => {
    const voice = buildVoicePrompt(ctx.voice ?? DEFAULT_VOICE, "plan");
    return `You are helping plan the implementation of a development task.
${buildCardContext(ctx)}
Current solution plan: ${ctx.sectionContent || "(none)"}

Help refine the implementation approach, suggest patterns, identify dependencies, and structure the work. Be specific and actionable.

${voice}${buildSectionBehaviorContext(ctx, "solution")}${buildToolUsageContext("solution")}`;
  },

  tests: (ctx) => {
    const lang = detectCardLanguage({ title: ctx.title, description: ctx.description });
    const voice = buildVoicePrompt(ctx.voice ?? DEFAULT_VOICE, "tests", { language: lang });
    // Prefer markdown with [x]/[ ] so the AI can see which items are already
    // checked; fall back to the stripped sectionContent for empty/legacy cases.
    const currentTests =
      testScenariosToMarkdown(ctx.testScenariosHtml || "") ||
      ctx.sectionContent ||
      "(none)";
    return `You are a manual tester walking a solo founder through this feature step by step. Your goal is to produce scenarios they can actually follow, not a spec of assertions.
${buildCardContext(ctx)}
Current test scenarios:
${currentTests}

Lead with the core flow — the handful of steps that prove the feature works at all. Add edge cases and error conditions only where they catch something the core flow cannot; a checklist nobody runs is worse than a short one. Use checkbox format: \`- [ ] Step description\`.

Scope what you write to what the user actually asked about. If they asked about one flow, cover that flow — do not regenerate or expand the whole checklist. A question deserves an answer, not a fresh batch of scenarios.

${voice}${buildSectionBehaviorContext(ctx, "tests")}${buildToolUsageContext("tests")}`;
  },
};

// Strip HTML tags for cleaner prompts
export function stripHtml(html: string): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
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
