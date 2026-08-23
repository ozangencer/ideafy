#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { mkdirSync } from "fs";
import { marked } from "marked";
import { v4 as uuidv4 } from "uuid";
import { normalizeUseWorktree, serializeUseWorktreeForDb } from "./serialize-card.js";
import { buildTestStyleContract } from "./test-style.generated.js";
import { buildPhaseHint, buildPhasePolicyBody } from "./phase-policy.generated.js";
import {
  createWorktree,
  ensureBranchInPlace,
  generateBranchName,
  getCurrentBranch,
  getWorktreePath,
  isGitRepo,
  resolveEffectiveWorktree,
  worktreeExists,
} from "./git-helpers.js";
import { existsSync } from "fs";

// The same style contract every other AI surface injects, pulled from
// lib/prompts/test-style.ts via scripts/sync-mcp-shared.mjs. Built without a
// language so the card-language rule stays in play: a tool description is
// static text assembled at server start, long before any card is known, so it
// cannot pick the Turkish or English body per card the way the in-app prompts
// do.
const TEST_STYLE_CONTRACT = buildTestStyleContract();

// Configure marked for Tiptap-compatible HTML
marked.setOptions({
  gfm: true,
  breaks: true,
});

// Convert markdown to Tiptap-compatible HTML with TaskList support
function markdownToTiptapHtml(markdown: string): string {
  // First, convert with marked
  let html = marked.parse(markdown) as string;

  // Convert standard checkbox lists to Tiptap TaskList format
  // Match: <ul> containing <li><input ...checkbox...> items
  // Note: Using [\s\S]*? instead of [^<]* to handle <code> tags inside list items
  html = html.replace(
    /<ul>\s*((?:<li><input[^>]*type="checkbox"[^>]*>[\s\S]*?<\/li>\s*)+)<\/ul>/gi,
    (match, items) => {
      const taskItems = items.replace(
        /<li><input([^>]*)type="checkbox"([^>]*)>([\s\S]*?)<\/li>/gi,
        (itemMatch: string, before: string, after: string, text: string) => {
          const isChecked = before.includes('checked') || after.includes('checked');
          return `<li data-type="taskItem" data-checked="${isChecked}"><label><input type="checkbox"${isChecked ? ' checked="checked"' : ''}><span></span></label><div><p>${text.trim()}</p></div></li>`;
        }
      );
      return `<ul data-type="taskList">${taskItems}</ul>`;
    }
  );

  return html;
}

// Normalize task item text for resilient merge matching (see lib/markdown.ts).
function normalizeTaskText(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .toLowerCase()
    // Blacklist common punctuation but keep letters (incl. Turkish) and digits.
    .replace(/[.,;:!?/\\|()[\]{}<>@#$%^&*"'`~=+\-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string, cap: number): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;

  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > cap) return cap + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function tokenize(s: string): string[] {
  return s.split(" ").filter((t) => t.length >= 3);
}

function tokenOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  let intersect = 0;
  for (const t of b) if (setA.has(t)) intersect++;
  return intersect / Math.max(a.length, b.length);
}

function findFuzzyMatch(target: string, candidates: string[]): string | null {
  if (candidates.includes(target)) return target;
  for (const c of candidates) {
    if (c.length < 6 || target.length < 6) continue;
    if (c.includes(target) || target.includes(c)) return c;
  }
  let best: { key: string; score: number } | null = null;
  const targetTokens = tokenize(target);
  for (const c of candidates) {
    const maxLen = Math.max(c.length, target.length);
    if (maxLen < 6) continue;

    const cap = Math.max(2, Math.floor(maxLen * 0.2));
    const d = levenshtein(target, c, cap);
    if (d <= cap) {
      const score = 1 - d / maxLen;
      if (!best || score > best.score) best = { key: c, score };
      continue;
    }

    const overlap = tokenOverlap(targetTokens, tokenize(c));
    if (overlap >= 0.6) {
      if (!best || overlap > best.score) best = { key: c, score: overlap };
    }
  }
  return best?.key ?? null;
}

interface TaskItemState {
  normalized: string;
  checked: boolean;
}

function markdownCheckboxStats(markdown: string): {
  total: number;
  checked: number;
} {
  const matches = markdown.match(/^\s*-\s*\[([ xX])\]/gm) || [];
  let checked = 0;
  for (const match of matches) {
    if (/\[[xX]\]/.test(match)) checked++;
  }
  return { total: matches.length, checked };
}

// Promote plain <ul><li>…</li></ul> to Tiptap taskList (all unchecked). Keeps
// extractTaskItems / mergeTestCheckState resilient to payloads that lack
// `- [ ]` markdown prefixes or to historically-stored plain lists. Idempotent.
function normalizeTestsHtml(html: string): string {
  if (!html) return html;
  return html.replace(
    /<ul\b([^>]*)>([\s\S]*?)<\/ul>/gi,
    (match, attrs: string, inner: string) => {
      if (/data-type\s*=\s*"taskList"/i.test(attrs)) return match;
      if (/<li[^>]*data-type="taskItem"/i.test(inner)) return match;
      if (!/<li\b/i.test(inner)) return match;
      const taskItems = inner.replace(
        /<li\b[^>]*>([\s\S]*?)<\/li>/gi,
        (_m: string, body: string) => {
          const trimmed = body.trim();
          const paragraph = /<p\b/i.test(trimmed)
            ? trimmed
            : `<p>${trimmed}</p>`;
          return `<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div>${paragraph}</div></li>`;
        }
      );
      return `<ul data-type="taskList">${taskItems}</ul>`;
    }
  );
}

function extractTaskItems(html: string): TaskItemState[] {
  const items: TaskItemState[] = [];
  const normalized = normalizeTestsHtml(html);
  const regex = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    const attrs = match[1];
    if (!/data-type\s*=\s*"taskItem"/i.test(attrs)) continue;
    const checkedMatch = attrs.match(/data-checked\s*=\s*"(true|false)"/i);
    if (!checkedMatch) continue;
    const body = match[2];
    const textMatch = body.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
    if (!textMatch) continue;
    const checked = checkedMatch[1] === "true";
    const normalizedText = normalizeTaskText(textMatch[1]);
    if (normalizedText) items.push({ normalized: normalizedText, checked });
  }
  return items;
}

// Assess whether a rewrite would silently wipe or drastically shrink the list.
// Returns `safe: false` when existing items are non-empty AND the new list
// retains < 50% of them (fuzzy match). Empty new list against non-empty existing
// is always unsafe.
function assessTestRewrite(existingHtml: string, newHtml: string): {
  safe: boolean;
  reason?: string;
  retained: number;
  existing: number;
} {
  const existingItems = extractTaskItems(existingHtml);
  if (!existingItems.length) return { safe: true, retained: 0, existing: 0 };

  const newItems = extractTaskItems(newHtml);
  if (!newItems.length) {
    return {
      safe: false,
      reason: "new test scenarios are empty — refusing to wipe existing list",
      retained: 0,
      existing: existingItems.length,
    };
  }

  const newKeys = newItems.map((i) => i.normalized);
  let retained = 0;
  for (const e of existingItems) {
    if (findFuzzyMatch(e.normalized, newKeys)) retained++;
  }

  const ratio = retained / existingItems.length;
  if (ratio < 0.5) {
    return {
      safe: false,
      reason: `new content retains only ${retained}/${existingItems.length} existing items (< 50%)`,
      retained,
      existing: existingItems.length,
    };
  }
  return { safe: true, retained, existing: existingItems.length };
}

function assessAppendOnlyRewrite(existingHtml: string, newHtml: string): {
  safe: boolean;
  reason?: string;
  retained: number;
  existing: number;
} {
  const existingItems = extractTaskItems(existingHtml);
  if (!existingItems.length) {
    return { safe: true, retained: 0, existing: 0 };
  }

  const newItems = extractTaskItems(newHtml);
  if (!newItems.length) {
    return {
      safe: false,
      reason: "new test scenarios are empty — refusing to wipe existing list",
      retained: 0,
      existing: existingItems.length,
    };
  }

  const newKeys = newItems.map((i) => i.normalized);
  let retained = 0;
  for (const e of existingItems) {
    if (findFuzzyMatch(e.normalized, newKeys)) retained++;
  }

  if (retained < existingItems.length) {
    return {
      safe: false,
      reason: `append-only save_tests requires all existing checklist items to be preserved; retained ${retained}/${existingItems.length}`,
      retained,
      existing: existingItems.length,
    };
  }

  return { safe: true, retained, existing: existingItems.length };
}

// Merge checked states from existing HTML into new HTML using fuzzy normalized
// matching, so minor rewordings don't reset checkboxes.
function mergeTestCheckState(existingHtml: string, newHtml: string): string {
  if (!existingHtml || !newHtml) return newHtml;

  const existingItems = extractTaskItems(existingHtml);
  if (existingItems.length === 0) return normalizeTestsHtml(newHtml);

  const existingKeys = existingItems.map((i) => i.normalized);
  const checkedMap = new Map<string, boolean>();
  for (const item of existingItems) checkedMap.set(item.normalized, item.checked);

  return normalizeTestsHtml(newHtml).replace(
    /<li([^>]*data-type="taskItem"[^>]*data-checked=")(?:true|false)("[^>]*>.*?<p>)(.*?)(<\/p>)/gi,
    (fullMatch, prefix, middle, text, suffix) => {
      const normalized = normalizeTaskText(text);
      if (!normalized) return fullMatch;
      const matchedKey = findFuzzyMatch(normalized, existingKeys);
      const wasChecked = matchedKey ? checkedMap.get(matchedKey) : false;
      if (wasChecked) {
        const result = `<li${prefix}true${middle}${text}${suffix}`;
        return result.replace(
          /<input type="checkbox"(?:\s+checked="checked")?>/,
          '<input type="checkbox" checked="checked">'
        );
      }
      return fullMatch;
    }
  );
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// DB path resolution — defaults to the OS-standard Electron userData location
// so every consumer (Electron app, standalone Next.js dev, MCP server) lands
// on one kanban.db. Override with IDEAFY_USER_DATA when pointing at an
// alternate DB (packaged DMG still passes it explicitly from electron/main.js).
function getDefaultDataDir(): string {
  const home = homedir();
  switch (process.platform) {
    case "darwin":
      return resolve(home, "Library/Application Support/ideafy");
    case "win32":
      return resolve(process.env.APPDATA || resolve(home, "AppData/Roaming"), "ideafy");
    default:
      return resolve(process.env.XDG_CONFIG_HOME || resolve(home, ".config"), "ideafy");
  }
}

function resolveDbPath(): string {
  const userDataEnv = process.env.IDEAFY_USER_DATA;
  const dir = userDataEnv ? resolve(userDataEnv) : getDefaultDataDir();
  mkdirSync(dir, { recursive: true });
  return resolve(dir, "kanban.db");
}

const DB_PATH = resolveDbPath();

// ============================================================================
// Image Extraction Helpers
// ============================================================================

interface ExtractedImage {
  id: string;
  data: string;
  mimeType: string;
  fieldName: string;
  index: number;
}

function extractImagesFromHtml(html: string, fieldName: string): {
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

function extractCardImages(card: Card): {
  cleanedCard: Card;
  images: ExtractedImage[];
} {
  const allImages: ExtractedImage[] = [];
  const cleanedCard = { ...card };

  // Process description
  if (card.description) {
    const { cleanedHtml, images } = extractImagesFromHtml(card.description, 'description');
    cleanedCard.description = cleanedHtml;
    allImages.push(...images);
  }

  // Process solutionSummary
  if (card.solutionSummary) {
    const { cleanedHtml, images } = extractImagesFromHtml(card.solutionSummary, 'solutionSummary');
    cleanedCard.solutionSummary = cleanedHtml;
    allImages.push(...images);
  }

  // Process testScenarios
  if (card.testScenarios) {
    const { cleanedHtml, images } = extractImagesFromHtml(card.testScenarios, 'testScenarios');
    cleanedCard.testScenarios = cleanedHtml;
    allImages.push(...images);
  }

  return { cleanedCard, images: allImages };
}

// Initialize database connection. WAL journal mode so this process and
// the Next server can read/write the same DB concurrently without
// SQLITE_BUSY errors.
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ============================================================================
// Input validation
// ============================================================================

// Card titles render into tooltips / mention previews that feed the DOM.
// Angle brackets and null bytes have no place in a kanban title and are the
// exact primitives needed for a stored-XSS payload if a future caller forgets
// to escape on render. Reject at the MCP boundary as defense-in-depth.
function assertValidCardTitle(title: unknown): asserts title is string {
  if (typeof title !== "string") {
    throw new Error("Card title must be a string");
  }
  const trimmed = title.trim();
  if (!trimmed) {
    throw new Error("Card title cannot be empty");
  }
  if (trimmed.length > 500) {
    throw new Error("Card title too long (max 500 characters)");
  }
  if (/[<>\0]/.test(title)) {
    throw new Error(
      "Card title cannot contain '<', '>' or null bytes (HTML injection guard)"
    );
  }
}

// ============================================================================
// Card ID Resolution Helper
// ============================================================================

/**
 * Resolves a card identifier to UUID.
 * Accepts: UUID, PREFIX-XX (e.g., KAN-54, INK-12), or just the number XX
 */
function resolveCardId(identifier: string): string | null {
  // Check if it's already a UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(identifier)) {
    return identifier;
  }

  // Check for PREFIX-XX format (e.g., KAN-54, INK-12)
  const prefixMatch = identifier.match(/^([A-Z]+)-(\d+)$/i);
  if (prefixMatch) {
    const prefix = prefixMatch[1].toUpperCase();
    const taskNumber = parseInt(prefixMatch[2], 10);

    // Find project by prefix, then find card by task_number and project_id
    const project = db.prepare(`SELECT id FROM projects WHERE UPPER(id_prefix) = ?`).get(prefix) as { id: string } | undefined;
    if (project) {
      const card = db.prepare(`SELECT id FROM cards WHERE task_number = ? AND project_id = ?`).get(taskNumber, project.id) as { id: string } | undefined;
      return card?.id || null;
    }
    return null;
  }

  // Check for just number (search across all cards)
  const numberMatch = identifier.match(/^(\d+)$/);
  if (numberMatch) {
    const taskNumber = parseInt(numberMatch[1], 10);
    const card = db.prepare(`SELECT id FROM cards WHERE task_number = ?`).get(taskNumber) as { id: string } | undefined;
    return card?.id || null;
  }

  return null;
}

// Types
interface Card {
  id: string;
  title: string;
  description: string;
  solutionSummary: string;
  testScenarios: string;
  status: string;
  complexity: string;
  priority: string;
  projectFolder: string;
  projectId: string | null;
  groupId: string | null;
  taskNumber: number | null;
  createdAt: string;
  updatedAt: string;
}

type Status = "ideation" | "backlog" | "bugs" | "progress" | "test" | "completed" | "withdrawn";

const STATUSES: readonly Status[] = [
  "ideation", "backlog", "bugs", "progress", "test", "completed", "withdrawn",
];

// Read a card's column back out of the row we just wrote.
//
// A tool result is the only thing the model sees, and it repeats it to the user
// as fact. So a result that claims a side effect has to be built from the stored
// row, never from what the SQL was meant to do. `result.changes` cannot stand in
// for this: `updated_at` is unconditional in every SET list, so it is 1 for any
// existing card even when nothing the caller asked for was written. That is
// exactly how save_opinion came to report a column move it never performed.
function readStatus(id: string): string {
  const row = db
    .prepare(`SELECT status FROM cards WHERE id = ?`)
    .get(id) as { status: string } | undefined;
  return row?.status ?? "unknown";
}

// Create MCP server
const server = new Server(
  {
    name: "ideafy-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_card",
        description: "Get a kanban card by ID",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Card ID: UUID, display ID (e.g., KAN-54), or task number",
            },
          },
          required: ["id"],
        },
      },
      {
        name: "update_card",
        description: "Update a kanban card fields (title, description, solutionSummary, status, complexity, priority, useWorktree, groupId). For testScenarios, use save_tests instead — update_card rejects it to protect checkbox states.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Card ID: UUID, display ID (e.g., KAN-54), or task number",
            },
            title: {
              type: "string",
              description: "Card title",
            },
            description: {
              type: "string",
              description: "Card description",
            },
            solutionSummary: {
              type: "string",
              description: "Detailed implementation summary in markdown. Should include: root cause analysis, current code flow, step-by-step changes with file paths and code snippets, changed files table, and notes. Write prose-level detail, not just headings.",
            },
            status: {
              type: "string",
              enum: ["ideation", "backlog", "bugs", "progress", "test", "completed", "withdrawn"],
              description: "Card status/column",
            },
            complexity: {
              type: "string",
              enum: ["low", "medium", "high"],
              description: "Task complexity (low, medium, high)",
            },
            priority: {
              type: "string",
              enum: ["low", "medium", "high"],
              description: "Task priority",
            },
            useWorktree: {
              type: ["boolean", "null"],
              description: "Per-card worktree override. true = force isolated worktree, false = work on main branch, null = follow project setting.",
            },
            groupId: {
              type: ["string", "null"],
              description: "card_groups.id this card belongs to — the chain the board folds it into. null removes it from its group. A group is membership only: it has no status, no completion state and no date of its own, so do not treat it as an epic.",
            },
          },
          required: ["id"],
        },
      },
      {
        name: "move_card",
        description: "Move a kanban card to a different column/status",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Card ID: UUID, display ID (e.g., KAN-54), or task number",
            },
            status: {
              type: "string",
              enum: ["ideation", "backlog", "bugs", "progress", "test", "completed", "withdrawn"],
              description: "Target status/column",
            },
          },
          required: ["id", "status"],
        },
      },
      {
        name: "list_cards",
        description: "List all kanban cards, optionally filtered by status",
        inputSchema: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["ideation", "backlog", "bugs", "progress", "test", "completed", "withdrawn"],
              description: "Filter by status (optional)",
            },
            projectId: {
              type: "string",
              description: "Filter by project ID (optional)",
            },
          },
        },
      },
      {
        name: "create_card",
        description: "Create a new kanban card. Markdown content in description and solutionSummary will be converted to HTML. Test scenarios should be added after implementation using save_tests.",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Card title (required)",
            },
            description: {
              type: "string",
              description: "Card description in markdown format",
            },
            solutionSummary: {
              type: "string",
              description: "Detailed implementation summary in markdown. MUST include: (1) Root cause / problem analysis, (2) Current architecture understanding with relevant code flow, (3) Step-by-step changes with specific file paths and code snippets showing before/after, (4) Changed files table (| File | Change |), (5) Important notes or caveats. Write prose-level detail, not just headings.",
            },
            status: {
              type: "string",
              enum: ["ideation", "backlog", "bugs", "progress", "test", "completed", "withdrawn"],
              description: "Card status/column (default: backlog)",
            },
            complexity: {
              type: "string",
              enum: ["simple", "medium", "complex"],
              description: "Task complexity (default: medium)",
            },
            priority: {
              type: "string",
              enum: ["low", "medium", "high"],
              description: "Task priority (default: medium)",
            },
            projectId: {
              type: "string",
              description: "Project ID to associate with (required)",
            },
            groupId: {
              type: "string",
              description: "card_groups.id this card belongs to — the chain the board folds it into. A group is membership only: it has no status, no completion state and no date of its own, so do not treat it as an epic.",
            },
          },
          required: ["title", "projectId"],
        },
      },
      {
        name: "save_plan",
        description: `Save a solution plan to a card and move it to In Progress. Use this when you've completed planning a task.

NOT the exit from Ideation. A card in the \`ideation\` column has not been evaluated yet: it needs save_opinion first, then the user's yes to move_card. Calling save_plan on an ideation card skips the evaluation the user asked for and jumps the card two columns at once — check the card's column before you call this.

VOICE CONTRACT (mandatory — adapt your prose to match the project's voice):

Before drafting the plan, call get_card to read the project's voice. Voice changes ONLY the tone, never the technical content — file paths, change lists, and trade-offs MUST appear in all three voices.

- entrepreneur — Plain prose. Lead with user impact and "why". Name the files/areas that change in human terms ("the login flow, the session check"), but skip line numbers and snippets. Trade-offs in one sentence each.
- builder (default) — Plain technical paragraphs grouped by feature area. Name file paths inline. End with a short Files line. No spec bullets unless a step has 5+ sub-changes.
- engineer — Numbered spec steps with file:line scope, function/symbol names, code snippets where they clarify, and explicit trade-offs. End with a Changed Files table (| File | Change |).`,
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Card ID: UUID, display ID (e.g., KAN-54), or task number",
            },
            solutionSummary: {
              type: "string",
              description: "Detailed implementation plan in markdown. MUST include: (1) Brief summary of the approach, (2) Current architecture understanding with relevant code flow (e.g. `Settings UI → POST /api/... → provider.method()`), (3) Step-by-step implementation with specific file paths, function names, and code snippets showing the planned changes, (4) Changed files table (| File | Change |), (5) Important notes or caveats. Write prose-level detail with code examples, not just headings or bullet points. Adapt the tone to the project's voice (see tool description).",
            },
          },
          required: ["id", "solutionSummary"],
        },
      },
      {
        name: "save_tests",
        description: `Save test scenarios to a card and move it to Human Test. Use this when you've completed implementation.

${TEST_STYLE_CONTRACT}

VOICE ACCENT (apply on top of the style contract — read project's voice via get_card):
- entrepreneur — keep step descriptions in plain language, reference UI labels users see, skip implementation jargon entirely.
- builder (default) — UI labels with the occasional technical hint when it helps reproduction. Still imperative manual steps.
- engineer — after each manual scenario you may add the related code path or function name in parentheses if it speeds debugging, but the step itself stays a manual instruction.

Append-only guard: if the card already has scenarios, EVERY existing item must still be present in your payload (fuzzy text match). Dropping even one item rejects the call — always send the existing list plus your additions.

Deleting scenarios: the guard above is absolute, so the only way to remove an item is allowDeletion: true. Pass it only on a turn where the user explicitly asked you to remove, drop, or undo scenarios. It makes your payload a literal replacement of the checklist — checkbox states included — so copy every surviving item, text and [x]/[ ], exactly as it stands today.`,
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Card ID: UUID, display ID (e.g., KAN-54), or task number",
            },
            testScenarios: {
              type: "string",
              description: "Test scenarios in markdown format with checkboxes (- [ ] format). Adapt the voice accent to the project (see tool description).",
            },
            allowDeletion: {
              type: "boolean",
              description: "Opt in to removing existing scenarios. Only set true when the user explicitly asked for a removal in this turn. Turns the payload into a literal replacement: whatever you send becomes the checklist, checkbox states and all. Omit for normal appends.",
            },
          },
          required: ["id", "testScenarios"],
        },
      },
      {
        name: "save_opinion",
        description: `Save AI opinion to a card after interactive ideation session. MUST include all required sections.

This tool does NOT move the card between columns — it only writes the Opinion tab. Whatever the verdict, the card stays where it is. To move it, ask the user first, then call move_card ('backlog' for a positive verdict, 'withdrawn' for a negative one). Never tell the user the card moved until move_card has returned.

VOICE CONTRACT (mandatory — adapt the lens AND the prose to the project's voice):

Before drafting, call get_card to read the project's voice. The required section structure is identical across voices, but what each section emphasizes changes:

- entrepreneur — Lead with user impact, scope creep, MVP fit, friction. Concerns and Recommendations focus on what users will or won't notice, not on race conditions or refactor opportunities. Plain prose; no file paths.
- builder (default) — Balance product and technical lenses. Name key risks (race conditions, schema drift) as 1-line callouts; mention rough complexity in plain words. File names appear inline only when they meaningfully shape the verdict.
- engineer — Lead with technical risk: race conditions, n+1, schema drift, API contract breaks, perf cliffs, refactor opportunities, testability and dependency cost. File:line references welcome. Product framing is secondary.

All three voices still produce the same Summary Verdict / Strengths / Concerns / Recommendations / Priority / Final Score sections — voice changes the prose inside, not the schema.`,
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Card ID: UUID, display ID (e.g., KAN-54), or task number",
            },
            aiOpinion: {
              type: "string",
              description: "AI opinion in markdown. MUST include these sections: ## Summary Verdict (Strong Yes/Yes/Maybe/No/Strong No), ## Strengths (bullet points), ## Concerns (bullet points), ## Recommendations (bullet points), ## Priority ([PRIORITY: low/medium/high] - reasoning), ## Final Score ([X/10] - justification). Adapt the prose inside each section to the project's voice (see tool description).",
            },
            aiVerdict: {
              type: "string",
              enum: ["positive", "negative"],
              description: "The verdict based on Summary Verdict: positive (Strong Yes, Yes, Maybe with score >= 6) or negative (No, Strong No, Maybe with score < 6)",
            },
          },
          required: ["id", "aiOpinion"],
        },
      },
      {
        name: "get_project_by_folder",
        description: "Find a project by its folder path. Use this to check if the current working directory is registered as a kanban project.",
        inputSchema: {
          type: "object",
          properties: {
            folderPath: {
              type: "string",
              description: "Full path to the project folder (e.g., /Users/name/projects/my-app)",
            },
          },
          required: ["folderPath"],
        },
      },
      {
        name: "ensure_branch",
        description:
          "Ensure the current working directory is on the git branch this card is supposed to be implemented on. If the card/project has worktree enforcement enabled and the branch is missing, creates it (and a worktree when the project uses worktrees). Idempotent: returns a no-op message when already on the correct branch or when enforcement is disabled.",
        inputSchema: {
          type: "object",
          properties: {
            cardId: {
              type: "string",
              description:
                "Card ID: UUID, display ID (e.g., KAN-54), or task number. The card must exist and have a resolvable project.",
            },
          },
          required: ["cardId"],
        },
      },
      {
        name: "bind_session_to_card",
        description:
          "Bind the current Claude Code session to an Ideafy card. The call returns the card's phase policy, which applies from this turn onward; the hook re-injects it on every later turn. Call this immediately after create_card when starting work from a plain terminal, or when the user names an existing card (e.g. 'this is for IDE-125'). The sessionId is provided by Claude Code in the hook input as the session_id field.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "Claude Code session ID. Read it from the hook input's session_id field, or from the SESSION_ID environment variable if available.",
            },
            cardId: {
              type: "string",
              description: "Card ID to bind this session to.",
            },
          },
          required: ["sessionId", "cardId"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "get_card": {
        const { id: rawId } = args as { id: string };
        const id = resolveCardId(rawId);
        if (!id) {
          return {
            content: [{ type: "text", text: `Card not found: ${rawId}` }],
            isError: true,
          };
        }
        const card = db.prepare(`
          SELECT
            id, title, description,
            solution_summary as solutionSummary,
            test_scenarios as testScenarios,
            status, complexity, priority,
            project_folder as projectFolder,
            project_id as projectId,
            group_id as groupId,
            task_number as taskNumber,
            git_worktree_path as gitWorktreePath,
            git_worktree_status as gitWorktreeStatus,
            use_worktree as useWorktree,
            created_at as createdAt,
            updated_at as updatedAt
          FROM cards WHERE id = ?
        `).get(id) as Card | undefined;

        if (!card) {
          return {
            content: [{ type: "text", text: `Card not found: ${id}` }],
            isError: true,
          };
        }

        // SQLite stores booleans as 0/1; normalize useWorktree for JSON output
        const rawUseWorktree = (card as unknown as { useWorktree: number | null }).useWorktree;
        (card as unknown as { useWorktree: boolean | null }).useWorktree =
          normalizeUseWorktree(rawUseWorktree);

        // Attach the project's voice so the calling AI can match its tone
        // without a second tool call. Defaults to 'builder' when missing.
        const projectRow = card.projectId
          ? (db.prepare(`SELECT voice FROM projects WHERE id = ?`).get(card.projectId) as { voice: string | null } | undefined)
          : undefined;
        const voice = (projectRow?.voice ?? "builder") as "entrepreneur" | "builder" | "engineer";
        (card as unknown as { project: { voice: string } }).project = { voice };

        // Extract images from HTML fields
        const { cleanedCard, images } = extractCardImages(card);

        // Build content array
        const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [
          { type: "text", text: JSON.stringify(cleanedCard, null, 2) }
        ];

        // Add images as separate content blocks
        for (const img of images) {
          content.push({
            type: "image",
            data: img.data,
            mimeType: img.mimeType,
          });
        }

        return { content };
      }

      case "update_card": {
        const { id: rawId, ...updates } = args as { id: string } & Partial<Card>;
        const id = resolveCardId(rawId);
        if (!id) {
          return {
            content: [{ type: "text", text: `Card not found: ${rawId}` }],
            isError: true,
          };
        }

        // Reject testScenarios via update_card — always route through save_tests
        // so checkbox states and shrink guard apply. Prevents silent list wipes.
        if ("testScenarios" in updates) {
          return {
            content: [{
              type: "text",
              text: "update_card does not accept testScenarios. Use save_tests instead — it preserves existing checkbox states and guards against accidental wipes.",
            }],
            isError: true,
          };
        }

        // Fields that need markdown to HTML conversion
        const markdownFields = ["description", "solutionSummary"];

        // Build SET clause dynamically
        const fieldMap: Record<string, string> = {
          title: "title",
          description: "description",
          solutionSummary: "solution_summary",
          status: "status",
          complexity: "complexity",
          priority: "priority",
          useWorktree: "use_worktree",
          groupId: "group_id",
        };

        // Reject unknown fields instead of dropping them. The loop below only
        // writes keys present in fieldMap, so a typo ("aiOpinion", "statuss")
        // used to vanish without a trace — and because `updated_at` is always
        // in the SET list, the UPDATE still touched a row and the tool still
        // said "updated successfully". Silently doing nothing while reporting
        // success is the failure this whole handler family is being fixed for.
        const unknownKeys = Object.keys(updates).filter(
          (key) =>
            !(key in fieldMap) &&
            (updates as Record<string, unknown>)[key] !== undefined
        );
        if (unknownKeys.length > 0) {
          return {
            content: [{
              type: "text",
              text: `update_card does not accept: ${unknownKeys.join(", ")}. ` +
                `Accepted fields: ${Object.keys(fieldMap).join(", ")}. ` +
                `For testScenarios use save_tests; for aiOpinion use save_opinion.`,
            }],
            isError: true,
          };
        }

        if (updates.title !== undefined) {
          assertValidCardTitle(updates.title);
        }

        const setClauses: string[] = ["updated_at = ?"];
        const values: unknown[] = [new Date().toISOString()];

        for (const [key, value] of Object.entries(updates)) {
          if (fieldMap[key] && value !== undefined) {
            setClauses.push(`${fieldMap[key]} = ?`);
            // Convert markdown to HTML for rich text fields
            if (markdownFields.includes(key) && typeof value === "string") {
              const htmlValue = markdownToTiptapHtml(value);
              values.push(htmlValue);
            } else if (key === "useWorktree") {
              // SQLite integer column: true/false → 1/0, null passes through
              values.push(serializeUseWorktreeForDb(value as boolean | null));
            } else {
              values.push(value);
            }
          }
        }

        // Only `updated_at` in the SET list means the caller passed an id and
        // nothing else. Bumping the timestamp and calling it an update is the
        // same silent no-op as above, one step further along.
        if (setClauses.length === 1) {
          return {
            content: [{
              type: "text",
              text: `update_card: nothing to update — no accepted field was provided for card ${id}.`,
            }],
            isError: true,
          };
        }

        values.push(id);

        const result = db.prepare(`
          UPDATE cards SET ${setClauses.join(", ")} WHERE id = ?
        `).run(...values);

        if (result.changes === 0) {
          return {
            content: [{ type: "text", text: `Card not found: ${id}` }],
            isError: true,
          };
        }

        const written = Object.keys(updates).filter((key) => key in fieldMap);
        return {
          content: [{
            type: "text",
            text: `Card ${id} updated (${written.join(", ")}). Card is in "${readStatus(id)}".`,
          }],
        };
      }

      case "move_card": {
        const { id: rawId, status } = args as { id: string; status: Status };
        const id = resolveCardId(rawId);
        if (!id) {
          return {
            content: [{ type: "text", text: `Card not found: ${rawId}` }],
            isError: true,
          };
        }

        // The MCP SDK's low-level Server does not validate arguments against
        // inputSchema, so the enum in the schema is documentation, not a gate.
        // An unlisted value ("Backlog") would be written straight through and
        // the card would disappear from every column while the tool reported
        // a successful move.
        if (!STATUSES.includes(status)) {
          return {
            content: [{
              type: "text",
              text: `move_card: "${status}" is not a column. Valid columns: ${STATUSES.join(", ")}.`,
            }],
            isError: true,
          };
        }

        const result = db.prepare(`
          UPDATE cards SET status = ?, updated_at = ? WHERE id = ?
        `).run(status, new Date().toISOString(), id);

        if (result.changes === 0) {
          return {
            content: [{ type: "text", text: `Card not found: ${id}` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text", text: `Card ${id} moved to ${readStatus(id)}` }],
        };
      }

      case "list_cards": {
        const { status, projectId } = args as { status?: Status; projectId?: string };

        let query = `
          SELECT
            id, title, description,
            solution_summary as solutionSummary,
            test_scenarios as testScenarios,
            status, complexity, priority,
            project_folder as projectFolder,
            project_id as projectId,
            group_id as groupId,
            task_number as taskNumber,
            git_worktree_path as gitWorktreePath,
            git_worktree_status as gitWorktreeStatus,
            use_worktree as useWorktree,
            created_at as createdAt,
            updated_at as updatedAt
          FROM cards
        `;
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (status) {
          conditions.push("status = ?");
          params.push(status);
        }
        if (projectId) {
          conditions.push("project_id = ?");
          params.push(projectId);
        }

        if (conditions.length > 0) {
          query += " WHERE " + conditions.join(" AND ");
        }

        query += " ORDER BY updated_at DESC";

        const cards = db.prepare(query).all(...params) as Card[];

        // SQLite stores booleans as 0/1; normalize useWorktree on every row
        for (const row of cards) {
          const raw = (row as unknown as { useWorktree: number | null }).useWorktree;
          (row as unknown as { useWorktree: boolean | null }).useWorktree =
            normalizeUseWorktree(raw);
        }

        // Extract images from all cards (max 10 total)
        const allImages: ExtractedImage[] = [];
        const cleanedCards: Card[] = [];
        const MAX_IMAGES = 10;

        for (const card of cards) {
          const { cleanedCard, images } = extractCardImages(card);
          cleanedCards.push(cleanedCard);

          // Add images up to the limit
          for (const img of images) {
            if (allImages.length < MAX_IMAGES) {
              allImages.push({ ...img, id: `card_${card.id.slice(0, 8)}_${img.id}` });
            }
          }
        }

        // Build content array
        const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [
          { type: "text", text: JSON.stringify(cleanedCards, null, 2) }
        ];

        // Add images as separate content blocks
        for (const img of allImages) {
          content.push({
            type: "image",
            data: img.data,
            mimeType: img.mimeType,
          });
        }

        if (allImages.length === MAX_IMAGES) {
          content.push({
            type: "text",
            text: `Note: Only first ${MAX_IMAGES} images shown. Use get_card for full image access.`
          });
        }

        return { content };
      }

      case "create_card": {
        const {
          title,
          description = "",
          solutionSummary = "",
          status = "backlog",
          complexity = "medium",
          priority = "medium",
          projectId = null,
          groupId = null,
        } = args as {
          title: string;
          description?: string;
          solutionSummary?: string;
          status?: Status;
          complexity?: string;
          priority?: string;
          projectId?: string | null;
          groupId?: string | null;
        };

        assertValidCardTitle(title);

        const now = new Date().toISOString();
        let taskNumber: number | null = null;
        let projectFolder = "";

        // If projectId provided, get next task number
        if (projectId) {
          const project = db.prepare(`
            SELECT id, folder_path, next_task_number FROM projects WHERE id = ?
          `).get(projectId) as { id: string; folder_path: string; next_task_number: number } | undefined;

          if (project) {
            taskNumber = project.next_task_number;
            projectFolder = project.folder_path;

            // Increment project's nextTaskNumber
            db.prepare(`
              UPDATE projects SET next_task_number = ?, updated_at = ? WHERE id = ?
            `).run(project.next_task_number + 1, now, projectId);
          }
        }

        const cardId = uuidv4();
        db.prepare(`
          INSERT INTO cards (
            id, title, description, solution_summary, test_scenarios,
            status, complexity, priority, project_folder, project_id,
            group_id, task_number, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          cardId,
          title,
          markdownToTiptapHtml(description),
          markdownToTiptapHtml(solutionSummary),
          "", // Test scenarios added after implementation via save_tests
          status,
          complexity,
          priority,
          projectFolder,
          projectId,
          groupId,
          taskNumber,
          now,
          now
        );

        // The column a card lands in already implies what happens next, but
        // nothing in the create_card result used to say so — and the offer
        // flow creates a card mid-turn, before any hook has spoken. One line
        // is enough here; bind_session_to_card follows with the full block in
        // the usual flow, and two copies of it in one turn is just noise.
        const hint = buildPhaseHint(status);

        return {
          content: [
            {
              type: "text",
              text: hint
                ? `Card created: ${cardId} (${title}). ${hint}`
                : `Card created: ${cardId} (${title})`,
            },
          ],
        };
      }

      case "save_plan": {
        const { id: rawId, solutionSummary } = args as { id: string; solutionSummary: string };
        const id = resolveCardId(rawId);
        if (!id) {
          return {
            content: [{ type: "text", text: `Card not found: ${rawId}` }],
            isError: true,
          };
        }

        // Convert markdown to Tiptap-compatible HTML with TaskList support
        const htmlContent = markdownToTiptapHtml(solutionSummary);

        const result = db.prepare(`
          UPDATE cards
          SET solution_summary = ?, status = 'progress', updated_at = ?
          WHERE id = ?
        `).run(htmlContent, new Date().toISOString(), id);

        if (result.changes === 0) {
          return {
            content: [{ type: "text", text: `Card not found: ${id}` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text", text: `Plan saved to card ${id}. Card is in "${readStatus(id)}".` }],
        };
      }

      case "save_tests": {
        const { id: rawId, testScenarios, allowDeletion } = args as {
          id: string;
          testScenarios: string;
          allowDeletion?: boolean;
        };
        const id = resolveCardId(rawId);
        if (!id) {
          return {
            content: [{ type: "text", text: `Card not found: ${rawId}` }],
            isError: true,
          };
        }

        // Opt-in destructive write. The guards below exist because the model
        // rewrites the whole checklist on every call and used to drop items
        // nobody asked it to drop. But they also made "forget those scenarios,
        // I don't want them" impossible to honour — every route back out of a
        // bad suggestion was closed. This flag reopens exactly that one door:
        // the payload becomes a literal replacement, merge included, so the
        // model must send the surviving items verbatim.
        const deletionRequested = allowDeletion === true;

        const existing = db.prepare(`SELECT test_scenarios FROM cards WHERE id = ?`).get(id) as { test_scenarios: string } | undefined;
        const existingItems = extractTaskItems(existing?.test_scenarios || "");
        const existingCheckedCount = existingItems.filter((item) => item.checked).length;
        const checkboxStats = markdownCheckboxStats(testScenarios);

        // A payload with no checkboxes at all is a format mistake, not a
        // deletion — refuse it even under allowDeletion rather than flattening
        // the checklist into prose. Emptying the list entirely stays a UI job.
        if (existingItems.length > 0 && checkboxStats.total === 0) {
          return {
            content: [{
              type: "text",
              text: "save_tests refused: payload contains no markdown checkboxes (`- [ ]` / `- [x]`). Send the checklist you want the card to end up with; plain paragraphs would wipe checkbox state. To clear the list completely, tell the user to delete the items in the Tests tab.",
            }],
            isError: true,
          };
        }

        if (!deletionRequested && existingCheckedCount > 0 && checkboxStats.checked === 0) {
          return {
            content: [{
              type: "text",
              text: `save_tests refused: existing list has ${existingCheckedCount} checked item(s) but your payload preserved 0 checked boxes. Include the existing [x] items verbatim so checkbox state is not lost.`,
            }],
            isError: true,
          };
        }

        // Convert markdown to Tiptap-compatible HTML with TaskList support
        const htmlContent = markdownToTiptapHtml(testScenarios);

        // Append-only guard: save_tests is intentionally stricter than generic
        // HTML merges. Every existing checklist item must still be present
        // (fuzzy match) in the new payload; otherwise we reject the write.
        if (!deletionRequested && existing?.test_scenarios) {
          const assessment = assessAppendOnlyRewrite(existing.test_scenarios, htmlContent);
          if (!assessment.safe) {
            return {
              content: [{
                type: "text",
                text: `save_tests refused: ${assessment.reason}. Call save_tests again with the full existing list plus your new additions (append-only). Existing items: ${assessment.existing}, retained in your payload: ${assessment.retained}. If the user explicitly asked you to remove scenarios, call save_tests again with allowDeletion: true and the exact list they want to keep.`,
              }],
              isError: true,
            };
          }
        }

        // Under allowDeletion the payload is authoritative, so the check-state
        // merge is skipped too — otherwise an item the user asked to un-tick
        // would come back checked.
        const mergedHtml = !deletionRequested && existing?.test_scenarios
          ? mergeTestCheckState(existing.test_scenarios, htmlContent)
          : htmlContent;

        const result = db.prepare(`
          UPDATE cards
          SET test_scenarios = ?, status = 'test', updated_at = ?
          WHERE id = ?
        `).run(mergedHtml, new Date().toISOString(), id);

        if (result.changes === 0) {
          return {
            content: [{ type: "text", text: `Card not found: ${id}` }],
            isError: true,
          };
        }

        // Report what a destructive write actually cost, so the removal shows
        // up in chat instead of landing silently on the card.
        let summary = `Test scenarios saved to card ${id}. Card is in "${readStatus(id)}"`;
        if (deletionRequested && existingItems.length > 0) {
          const kept = assessAppendOnlyRewrite(existing?.test_scenarios || "", htmlContent).retained;
          const removed = existingItems.length - kept;
          summary += ` — allowDeletion: ${removed} of ${existingItems.length} existing scenario(s) removed, ${kept} kept`;
        }

        return {
          content: [{ type: "text", text: summary }],
        };
      }

      case "save_opinion": {
        const { id: rawId, aiOpinion, aiVerdict } = args as { id: string; aiOpinion: string; aiVerdict?: "positive" | "negative" };
        const id = resolveCardId(rawId);
        if (!id) {
          return {
            content: [{ type: "text", text: `Card not found: ${rawId}` }],
            isError: true,
          };
        }

        // Convert markdown to Tiptap-compatible HTML
        const htmlContent = markdownToTiptapHtml(aiOpinion);

        const result = db.prepare(`
          UPDATE cards
          SET ai_opinion = ?, ai_verdict = ?, updated_at = ?
          WHERE id = ?
        `).run(htmlContent, aiVerdict || null, new Date().toISOString(), id);

        if (result.changes === 0) {
          return {
            content: [{ type: "text", text: `Card not found: ${id}` }],
            isError: true,
          };
        }

        return {
          content: [{
            type: "text",
            text: `AI opinion saved to card ${id}${aiVerdict ? ` (verdict: ${aiVerdict})` : ''}. ` +
              `Card is still in "${readStatus(id)}" — this tool does not move cards. ` +
              `Ask the user before calling move_card.`,
          }],
        };
      }

      case "ensure_branch": {
        const { cardId: rawId } = args as { cardId: string };
        const cardId = resolveCardId(rawId);
        if (!cardId) {
          return {
            content: [{ type: "text", text: `Card not found: ${rawId}` }],
            isError: true,
          };
        }

        const card = db
          .prepare(
            `SELECT
               id, title, task_number as taskNumber,
               project_id as projectId,
               project_folder as projectFolder,
               git_branch_name as gitBranchName,
               git_worktree_path as gitWorktreePath,
               use_worktree as useWorktree
             FROM cards WHERE id = ?`
          )
          .get(cardId) as
          | {
              id: string;
              title: string;
              taskNumber: number | null;
              projectId: string | null;
              projectFolder: string | null;
              gitBranchName: string | null;
              gitWorktreePath: string | null;
              useWorktree: number | null;
            }
          | undefined;

        if (!card) {
          return {
            content: [{ type: "text", text: `Card not found: ${cardId}` }],
            isError: true,
          };
        }

        const project = card.projectId
          ? (db
              .prepare(
                `SELECT
                   id, folder_path as folderPath,
                   id_prefix as idPrefix,
                   use_worktrees as useWorktrees
                 FROM projects WHERE id = ?`
              )
              .get(card.projectId) as
              | {
                  id: string;
                  folderPath: string;
                  idPrefix: string;
                  useWorktrees: number | null;
                }
              | undefined)
          : undefined;

        const cardUseWorktree = normalizeUseWorktree(card.useWorktree);
        const projectUseWorktrees = project
          ? Boolean(project.useWorktrees ?? 1)
          : null;
        const effective = cardUseWorktree ?? projectUseWorktrees ?? true;

        if (!effective) {
          // Distinguish whether the disable came from the card override or
          // the project default — the previous wording always blamed the
          // card, which was misleading when the card was set to "follow
          // project" and the project itself had worktrees turned off.
          const reason =
            cardUseWorktree === false
              ? "Worktree enforcement is disabled for this card (card.useWorktree=false)."
              : "Worktree enforcement is disabled at the project level (project.useWorktrees=false) and this card has no override.";
          return {
            content: [
              {
                type: "text",
                text: `${reason} No branch change performed.`,
              },
            ],
          };
        }

        const projectFolder = project?.folderPath || card.projectFolder || "";
        if (!projectFolder) {
          return {
            content: [
              {
                type: "text",
                text: "Cannot determine project folder for this card. Aborting ensure_branch.",
              },
            ],
            isError: true,
          };
        }

        if (!(await isGitRepo(projectFolder))) {
          return {
            content: [
              {
                type: "text",
                text: `Project folder is not a git repo: ${projectFolder}. ensure_branch has no work to do.`,
              },
            ],
          };
        }

        let targetBranch = card.gitBranchName;
        let branchGenerated = false;
        if (!targetBranch) {
          if (!project || card.taskNumber == null) {
            return {
              content: [
                {
                  type: "text",
                  text: "Card has no gitBranchName and no taskNumber/project to generate one from. Set a branch name or bind a project before calling ensure_branch.",
                },
              ],
              isError: true,
            };
          }
          targetBranch = generateBranchName(
            project.idPrefix,
            card.taskNumber,
            card.title
          );
          branchGenerated = true;
        }

        const useWorktreeMode = projectUseWorktrees ?? true;
        const nowIso = new Date().toISOString();

        // Worktree mode — prefer an existing worktree path; if missing, create.
        if (useWorktreeMode) {
          const expectedPath =
            card.gitWorktreePath || getWorktreePath(projectFolder, targetBranch);

          if (await worktreeExists(projectFolder, expectedPath)) {
            // Worktree exists — verify it is actually on the target branch.
            const branchInWorktree = await getCurrentBranch(expectedPath);
            if (branchInWorktree === targetBranch) {
              if (
                branchGenerated ||
                card.gitBranchName !== targetBranch ||
                card.gitWorktreePath !== expectedPath
              ) {
                db.prepare(
                  `UPDATE cards
                   SET git_branch_name = ?, git_branch_status = 'active',
                       git_worktree_path = ?, git_worktree_status = 'active',
                       updated_at = ?
                   WHERE id = ?`
                ).run(targetBranch, expectedPath, nowIso, cardId);
              }
              return {
                content: [
                  {
                    type: "text",
                    text: `Already on branch "${targetBranch}" in worktree ${expectedPath}. No changes made.`,
                  },
                ],
              };
            }
          }

          const result = await createWorktree(projectFolder, targetBranch);
          if (!result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `Failed to create worktree for branch "${targetBranch}": ${result.error ?? "unknown error"}`,
                },
              ],
              isError: true,
            };
          }

          db.prepare(
            `UPDATE cards
             SET git_branch_name = ?, git_branch_status = 'active',
                 git_worktree_path = ?, git_worktree_status = 'active',
                 updated_at = ?
             WHERE id = ?`
          ).run(targetBranch, result.worktreePath, nowIso, cardId);

          return {
            content: [
              {
                type: "text",
                text: `Worktree ready at ${result.worktreePath} on branch "${targetBranch}". cd into it to continue.`,
              },
            ],
          };
        }

        // In-place mode — the project opted out of worktrees; just switch
        // branches in the project folder.
        const cwd =
          card.gitWorktreePath && existsSync(card.gitWorktreePath)
            ? card.gitWorktreePath
            : projectFolder;

        const currentBranch = await getCurrentBranch(cwd);
        if (currentBranch === targetBranch) {
          if (branchGenerated || card.gitBranchName !== targetBranch) {
            db.prepare(
              `UPDATE cards
               SET git_branch_name = ?, git_branch_status = 'active', updated_at = ?
               WHERE id = ?`
            ).run(targetBranch, nowIso, cardId);
          }
          return {
            content: [
              {
                type: "text",
                text: `Already on branch "${targetBranch}" in ${cwd}. No changes made.`,
              },
            ],
          };
        }

        const checkout = await ensureBranchInPlace(cwd, targetBranch);
        if (!checkout.success) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to switch to branch "${targetBranch}" in ${cwd}: ${checkout.error ?? "unknown error"}`,
              },
            ],
            isError: true,
          };
        }

        db.prepare(
          `UPDATE cards
           SET git_branch_name = ?, git_branch_status = 'active', updated_at = ?
           WHERE id = ?`
        ).run(targetBranch, nowIso, cardId);

        const stashNote = checkout.error ? ` (${checkout.error})` : "";
        return {
          content: [
            {
              type: "text",
              text: `Switched to branch "${targetBranch}" in ${cwd}.${stashNote}`,
            },
          ],
        };
      }

      case "bind_session_to_card": {
        const { sessionId, cardId } = args as { sessionId: string; cardId: string };

        if (!sessionId || !cardId) {
          return {
            content: [{ type: "text", text: "sessionId and cardId are required" }],
            isError: true,
          };
        }

        const card = db
          .prepare(
            `SELECT id, project_id as projectId, title, status, task_number as taskNumber,
                    use_worktree as useWorktree, git_branch_name as gitBranchName
             FROM cards WHERE id = ?`
          )
          .get(cardId) as
          | {
              id: string;
              projectId: string | null;
              title: string;
              status: string;
              taskNumber: number | null;
              useWorktree: number | null;
              gitBranchName: string | null;
            }
          | undefined;

        if (!card) {
          return {
            content: [{ type: "text", text: `Card not found: ${cardId}` }],
            isError: true,
          };
        }

        const now = new Date().toISOString();
        const existing = db
          .prepare(`SELECT session_id FROM ideafy_sessions WHERE session_id = ?`)
          .get(sessionId) as { session_id: string } | undefined;

        if (existing) {
          db.prepare(
            `UPDATE ideafy_sessions SET project_id = ?, state = 'bound', card_id = ?, updated_at = ? WHERE session_id = ?`
          ).run(card.projectId, card.id, now, sessionId);
        } else {
          db.prepare(
            `INSERT INTO ideafy_sessions (session_id, project_id, state, card_id, created_at, updated_at) VALUES (?, ?, 'bound', ?, ?, ?)`
          ).run(sessionId, card.projectId, card.id, now, now);
        }

        // The phase policy used to arrive only with the NEXT user turn's hook
        // call, which left the turn that creates and binds a card — the offer
        // flow's normal shape — running with no phase policy at all. That is
        // how an ideation card got a plan written straight onto it: nothing in
        // context said an opinion comes first. Return the same clauses the hook
        // would inject, so they apply from this turn.
        const project = card.projectId
          ? (db
              .prepare(
                `SELECT id_prefix as idPrefix, use_worktrees as useWorktrees FROM projects WHERE id = ?`
              )
              .get(card.projectId) as
              | { idPrefix: string; useWorktrees: number }
              | undefined)
          : undefined;

        const policy = buildPhasePolicyBody(
          {
            id: card.id,
            title: card.title,
            status: card.status,
            displayId:
              project && card.taskNumber != null
                ? `${project.idPrefix}-${card.taskNumber}`
                : null,
          },
          card.status === "progress"
            ? resolveEffectiveWorktree(
                {
                  useWorktree: normalizeUseWorktree(card.useWorktree),
                  gitBranchName: card.gitBranchName,
                  taskNumber: card.taskNumber,
                  title: card.title,
                },
                project
                  ? { useWorktrees: project.useWorktrees === 1, idPrefix: project.idPrefix }
                  : null
              )
            : undefined
        );

        const bound = `Session ${sessionId} bound to card ${card.id} ("${card.title}", column: ${card.status}).`;

        return {
          content: [
            {
              type: "text",
              text: policy
                ? `${bound} The phase policy below applies from this turn onward — follow it now, do not wait for the next turn.\n\n${policy}`
                : `${bound} This column has no phase policy.`,
            },
          ],
        };
      }

      case "get_project_by_folder": {
        const { folderPath } = args as { folderPath: string };

        const project = db.prepare(`
          SELECT
            id, name, folder_path as folderPath, id_prefix as idPrefix,
            color, next_task_number as nextTaskNumber,
            voice
          FROM projects
          WHERE folder_path = ?
        `).get(folderPath) as {
          id: string;
          name: string;
          folderPath: string;
          idPrefix: string;
          color: string;
          nextTaskNumber: number;
          voice: string | null;
        } | undefined;

        if (!project) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                found: false,
                message: "Bu proje kanban'da kayitli degil. Oncelikle projeyi kanban'a eklemen gerekiyor."
              })
            }],
          };
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ found: true, project })
          }],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Ideafy MCP server started");
}

main().catch(console.error);
