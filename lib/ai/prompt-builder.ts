/**
 * Shared prompt-building utilities for AI chat.
 * Used by both local chat-stream and remote-job-runner.
 */

import type { SectionType, ConversationMessage, Voice } from "@/lib/types";
import { DEFAULT_VOICE } from "@/lib/types";
import { testScenariosToMarkdown } from "@/lib/markdown";
import { detectCardLanguage } from "@/lib/prompts/test-style";
import { buildVoicePrompt } from "@/lib/prompts/voice-style";

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
  return `
CURRENT CARD CONTEXT:
- Card ID: ${ctx.displayId}
- Card UUID: ${ctx.uuid}
- Title: "${ctx.title}"
- Project: ${ctx.projectName || "(none)"}

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

## IMPORTANT: Test Scenarios - Append Only
When you make code changes and need to update test scenarios, you MUST only APPEND new test scenarios to the existing ones.
- NEVER remove or overwrite existing test scenarios unless the user explicitly asks you to
- Preserve the EXACT markdown format of existing test scenarios (headings, checkbox syntax, grouping)
- Preserve the checked state of completed items: items marked as [x] MUST remain [x], do NOT reset them to [ ]
- Add new test cases at the end of the existing list
- If you call save_tests, include ALL existing test scenarios plus your new additions`;

    if (ctx.description) {
      actionContext += `\n\nCard Description: ${ctx.description}`;
    }
    if (ctx.solutionSummary) {
      actionContext += `\nImplementation Plan: ${ctx.solutionSummary}`;
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
When you produce substantive content for a card field, you MUST save it using the appropriate MCP tool.
Do NOT just respond with text — persist it to the card so it appears in the UI.
This includes when you agree with, refine, or expand on the user's ideas — always save the resulting content.
Only skip saving for pure clarifying questions or very brief acknowledgments without new content.
${section === "solution" ? `
Do NOT call save_plan. The user reviews your plan and clicks Append or Replace via the Apply buttons in the chat UI; clicking Apply also moves the card to In Progress automatically when appropriate. If you call save_plan you will silently overwrite their existing solution — that is the destructive bug Apply was built to prevent. Respond with your plan as normal markdown text and let the user click Apply.
Do NOT automatically generate test scenarios when producing a plan. Only generate tests if the user explicitly asks for it.` : ""}${section === "detail" ? `
Do NOT call update_card to write the description. The user reviews your reply and decides whether to Append or Replace via the Apply buttons in the chat UI. If you call update_card with a description, you will silently overwrite their existing content — that is the destructive bug Apply was built to prevent. Respond with your refined content as normal markdown text and let the user click Apply.` : ""}${section === "opinion" ? `
Do NOT call save_opinion. The user reviews your evaluation and clicks Append or Replace via the Apply buttons in the chat UI; the verdict is parsed from your "## Summary Verdict (...)" line automatically when Apply is clicked. If you call save_opinion you will silently overwrite their existing opinion — that is the destructive bug Apply was built to prevent. Respond with your evaluation as normal markdown (include the Summary Verdict / Strengths / Concerns / Recommendations / Priority / Final Score sections) and let the user click Apply.` : ""}${section === "tests" ? `
When you produce test scenarios, call save_tests with the test content in markdown checkbox format. NEVER use update_card for testScenarios — it bypasses checkbox state preservation.
IMPORTANT: Always APPEND new test scenarios to the existing ones. Never remove existing test scenarios unless the user explicitly asks. Preserve the EXACT markdown format and checked state ([x]) of existing items. Include all existing scenarios plus new additions when calling save_tests. When you only need to append new items after a code change, still call save_tests with the full existing list plus the new items — save_tests will merge checkbox states automatically.` : ""}`;
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

Cover happy paths, edge cases, and error conditions. Use checkbox format: \`- [ ] Step description\`.

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
