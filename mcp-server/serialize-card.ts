import { AI_OPINION_PLANNING_RULE } from "./opinion.generated.js";
import {
  CHAIN_IMPLEMENTATION_RULE,
  PRIOR_DECISIONS_RULE,
} from "./prior-decisions.generated.js";

// Normalize SQLite INTEGER boolean columns (stored as 0/1 or NULL) to JS
// values. Null/undefined stays null so callers can distinguish "no override"
// from "explicit false".
export function normalizeUseWorktree(
  value: number | boolean | null | undefined
): boolean | null {
  if (value === null || value === undefined) return null;
  return Boolean(value);
}

// Reverse direction: JS boolean|null → SQLite INTEGER|NULL. null stays null
// (clears the override); true → 1; false → 0.
export function serializeUseWorktreeForDb(
  value: boolean | null
): 0 | 1 | null {
  if (value === null) return null;
  return value ? 1 : 0;
}

// Which workspace a project belongs to. Mirrors lib/project-serialize.ts's
// normalizeProjectMode: anything that is not the literal "work" — including
// `undefined`, which is what a `SELECT *` yields on a DB from before the
// column existed — is development, the mode every project had until then.
export type ProjectMode = "development" | "work";

export function normalizeProjectMode(value: unknown): ProjectMode {
  return value === "work" ? "work" : "development";
}

// ============================================================================
// Image extraction
// ============================================================================

export interface ExtractedImage {
  id: string;
  data: string;
  mimeType: string;
  fieldName: string;
  index: number;
}

export function extractImagesFromHtml(html: string, fieldName: string): {
  cleanedHtml: string;
  images: ExtractedImage[];
} {
  const images: ExtractedImage[] = [];
  let index = 0;

  const imgRegex = /<img[^>]*src=["']data:(image\/[^;]+);base64,([^"']+)["'][^>]*>/gi;

  const cleanedHtml = html.replace(imgRegex, (match, mimeType, data) => {
    const id = `${fieldName}_image_${index}`;
    images.push({ id, data, mimeType, fieldName, index });
    index++;
    return `[IMAGE: ${id}]`;
  });

  return { cleanedHtml, images };
}

// The Tiptap HTML fields that can carry pasted base64 images. Each is swapped
// for an [IMAGE: <field>_image_<n>] marker so the JSON stays small and the
// image travels as its own content block.
const IMAGE_FIELDS = ["description", "solutionSummary", "testScenarios", "aiOpinion"] as const;

type ImageField = (typeof IMAGE_FIELDS)[number];

export function extractCardImages<T extends Partial<Record<ImageField, string | null>>>(card: T): {
  cleanedCard: T;
  images: ExtractedImage[];
} {
  const allImages: ExtractedImage[] = [];
  const cleanedCard = { ...card };

  for (const field of IMAGE_FIELDS) {
    const html = card[field];
    if (!html) continue;
    const { cleanedHtml, images } = extractImagesFromHtml(html, field);
    (cleanedCard as Record<ImageField, string>)[field] = cleanedHtml;
    allImages.push(...images);
  }

  return { cleanedCard, images: allImages };
}

// ============================================================================
// AI Opinion planning note
// ============================================================================

// The columns a plan is written from. An opinion on an ideation card is still
// an evaluation waiting for the user's yes, not something to build on.
const PLANNING_STATUSES = new Set(["backlog", "bugs", "progress"]);

// Tiptap can store a cleared field as <p></p>, so a field only counts once its
// tags and whitespace are gone and something is left.
function hasHtmlText(html: string | null | undefined): boolean {
  if (!html) return false;
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length > 0;
}

// get_card is the one call every planning path makes — whichever CLI, bound
// to a card or not, saving through save_plan or writing the plan in chat. So
// when the card has an opinion to build on, the rule rides along with it.
// Returns null when there is nothing to add, leaving the response unchanged.
export function buildOpinionPlanningNote(card: {
  status: string;
  aiOpinion?: string | null;
}): string | null {
  if (!PLANNING_STATUSES.has(card.status)) return null;
  if (!hasHtmlText(card.aiOpinion)) return null;
  return `If you are writing a plan for this card:\n${AI_OPINION_PLANNING_RULE}`;
}

// ============================================================================
// Prior decisions note
// ============================================================================

// Same reach as the opinion note: a session opened by hand plans without any
// of Ideafy's prompts, so the "check the other cards first" rule rides on
// get_card. Unlike the opinion it needs nothing on the card itself — every
// plan should look for contradictions and overlapping work.
export function buildPriorDecisionsNote(card: { status: string }): string | null {
  if (!PLANNING_STATUSES.has(card.status)) return null;
  return `Before you write a plan for this card:\n${PRIOR_DECISIONS_RULE}`;
}

// ============================================================================
// Chain implementation note
// ============================================================================

// A planned card in progress is one being built. When it sits in a chain, a
// session opened by hand gets the same "build on the predecessors, keep one
// of their core items as a regression step" rule the implementation prompt
// carries. Takes the chain get_card just computed, so a card in no group —
// or one with no plan yet — reads exactly as before.
export function buildChainImplementationNote(
  card: { status: string; solutionSummary?: string | null },
  chain: object | null
): string | null {
  if (!chain) return null;
  if (card.status !== "progress") return null;
  if (!hasHtmlText(card.solutionSummary)) return null;
  return `If you are implementing this card:\n${CHAIN_IMPLEMENTATION_RULE}`;
}
