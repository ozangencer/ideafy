import { SectionType } from "@/lib/types";

export interface CardContext {
  title: string;
  description: string;
  aiOpinion: string;
  solutionSummary: string;
  testScenarios: string;
}

const MAX_CONTEXT_LENGTH = 500;

/**
 * Decode common HTML entities and strip tags before pasting card content into
 * a prompt. More aggressive than `@/lib/prompts`'s stripHtml because card
 * bodies coming from TipTap/Marked often contain HTML entities that confuse
 * the LLM unless decoded first.
 */
function stripHtml(html: string): string {
  if (!html) return "";
  const decoded = html
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x22;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
  return decoded.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function truncate(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

interface SectionSpec {
  placeholder: string;
  systemPrompt: (ctx: CardContext) => string;
  userPromptPrefix: (ctx: CardContext) => string;
}

export const SECTION_CONFIG: Record<SectionType, SectionSpec> = {
  detail: {
    placeholder: "Ask AI to improve or expand this detail...",
    systemPrompt: (ctx) => {
      const desc = truncate(stripHtml(ctx.description), MAX_CONTEXT_LENGTH);
      return `You are helping improve a development task description.
Task: "${ctx.title}"
Current description: ${desc || "(empty)"}

Respond with ONLY the updated description content in markdown. No explanations.`;
    },
    userPromptPrefix: (ctx) => `Task: ${ctx.title}\n\nRequest: `,
  },
  opinion: {
    placeholder: "Ask AI for technical analysis...",
    systemPrompt: (ctx) => {
      const desc = truncate(stripHtml(ctx.description), MAX_CONTEXT_LENGTH);
      const opinion = truncate(stripHtml(ctx.aiOpinion), MAX_CONTEXT_LENGTH);
      return `You are a senior software architect evaluating a task.
Task: "${ctx.title}"
Description: ${desc || "(none)"}
Current opinion: ${opinion || "(none)"}

Respond with ONLY your technical opinion in markdown. No introductions.`;
    },
    userPromptPrefix: (ctx) => `Evaluate: ${ctx.title}\n\nQuestion: `,
  },
  solution: {
    placeholder: "Ask AI to refine the solution approach...",
    systemPrompt: (ctx) => {
      const desc = truncate(stripHtml(ctx.description), MAX_CONTEXT_LENGTH);
      const solution = truncate(stripHtml(ctx.solutionSummary), MAX_CONTEXT_LENGTH);
      return `You are helping plan the implementation of a task.
Task: "${ctx.title}"
Description: ${desc || "(none)"}
Current solution: ${solution || "(none)"}

Respond with ONLY the solution content in markdown. No explanations.`;
    },
    userPromptPrefix: (ctx) => `Task: ${ctx.title}\n\nRefine: `,
  },
  tests: {
    placeholder: "Ask AI to add test scenarios...",
    systemPrompt: (ctx) => {
      const desc = truncate(stripHtml(ctx.description), MAX_CONTEXT_LENGTH);
      const solution = truncate(stripHtml(ctx.solutionSummary), 300);
      const tests = truncate(stripHtml(ctx.testScenarios), MAX_CONTEXT_LENGTH);
      return `You are a QA engineer writing test scenarios.
Task: "${ctx.title}"
Description: ${desc || "(none)"}
Solution: ${solution || "(none)"}
Current tests: ${tests || "(none)"}

Respond with test scenarios using: - [ ] Test description
Cover happy paths, edge cases, and error conditions.`;
    },
    userPromptPrefix: (ctx) => `Task: ${ctx.title}\n\nTest request: `,
  },
};
