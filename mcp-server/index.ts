#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { openDatabase, transaction } from "./db.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { mkdirSync } from "fs";
import { marked } from "marked";
import { v4 as uuidv4 } from "uuid";
import {
  normalizeUseWorktree,
  normalizeProjectMode,
  serializeUseWorktreeForDb,
  extractCardImages,
  buildOpinionPlanningNote,
  buildPriorDecisionsNote,
  buildChainImplementationNote,
  type ExtractedImage,
} from "./serialize-card.js";
import { parseOutputPaths, recordOutputPath } from "./output-paths.js";
import { hasCapability, missingCapabilityMessage } from "./schema-caps.js";
import {
  AI_OPINION_PLANNING_RULE,
  PRIOR_DECISIONS_RULE,
  buildPhaseHint,
  buildPhasePolicyBody,
  buildTestStyleContract,
  clearQueue,
  completedAtFor,
  dequeueCard,
  enqueueCard,
  completedAtOnCreate,
  describeOpinionMarkers,
  isStatus,
  listQueueRows,
  moveCard,
  normalizeComplexity,
  queueDisplayId,
  queueKindOf,
  queuedRunsInWorktree,
  saveOpinion,
  statusAfterPlan,
  statusAfterTests,
} from "./shared.js";
import {
  createWorktree,
  ensureBranchInPlace,
  generateBranchName,
  getCurrentBranch,
  getWorktreePath,
  isGitRepo,
  listChangedFiles,
  resolveEffectiveWorktree,
  shouldUseWorktree,
  worktreeExists,
} from "./git-helpers.js";
import {
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_SEARCH_STATUSES,
  MAX_OPEN_WORK_FILES,
  listOpenWork,
  searchCards,
} from "./card-search.js";
import { linkCardsInHtml, projectIdOfCard } from "./card-link-resolver.js";
import { existsSync } from "fs";
import {
  assertGroupAssignable,
  createGroup,
  deleteGroup,
  getChainForCard,
  listGroupsWithChains,
  moveCardInChain,
  normalizeGroupId,
  updateGroup,
} from "./card-groups.js";

// The same style contract every other AI surface injects, imported from
// lib/prompts/test-style.ts. Built without a
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

// Initialize database connection. openDatabase sets WAL and a busy timeout so
// this process and the Next server can read/write the same DB concurrently
// without SQLITE_BUSY errors. A Node without node:sqlite exits here with a
// one-line reason instead of a stack trace.
const db = (() => {
  try {
    return openDatabase(DB_PATH);
  } catch (error) {
    console.error(`[ideafy-mcp] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
})();

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
  // Only get_card selects these. The accepted evaluation is what a plan has
  // to build on, so every phase reads it alongside the description.
  aiOpinion?: string;
  aiVerdict?: string | null;
  // get_card and list_cards select it: the opinion's Final Score, 0–10.
  aiScore?: number | null;
  status: string;
  complexity: string;
  priority: string;
  projectFolder: string;
  projectId: string | null;
  groupId: string | null;
  taskNumber: number | null;
  // Only get_card selects it: files the card's work produced, relative to
  // the project folder, as recorded by save_output. null when none.
  outputPaths?: string[] | null;
  createdAt: string;
  updatedAt: string;
}

type Status = "ideation" | "backlog" | "bugs" | "progress" | "test" | "completed" | "withdrawn";

const STATUSES: readonly Status[] = [
  "ideation", "backlog", "bugs", "progress", "test", "completed", "withdrawn",
];

// Write one content column and, when `nextStatus` says so, move the card —
// one transaction, the move through lib/card-ops' moveCard so completed_at and
// the queue trigger behave as they do for move_card. false = no such card.
function saveFieldAndMove(
  id: string,
  column: "solution_summary" | "test_scenarios",
  html: string,
  nextStatus: (current: string) => Status | null
): boolean {
  return transaction(db, () => {
    const row = db.prepare(`SELECT status FROM cards WHERE id = ?`).get(id) as { status: string } | undefined;
    if (!row) return false;
    const now = new Date().toISOString();
    db.prepare(`UPDATE cards SET ${column} = ?, updated_at = ? WHERE id = ?`).run(html, now, id);
    const target = nextStatus(row.status);
    if (target) moveCard(db, id, target, now);
    return true;
  });
}

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

// ai_score arrived with 0021, which an app older than this plugin has not run
// yet: read cards still list, with no score.
function aiScoreColumn(conn: typeof db): string {
  return hasCapability(conn, "aiScore") ? "ai_score as aiScore," : "NULL as aiScore,";
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
        description: "Get a kanban card by ID. When the card belongs to a group, `chain` gives its place in that chain: position/total, predecessors and successors in chain order (displayId, title, status), and `next`, the chain's first member that is neither completed nor withdrawn.",
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
        description: "Update a kanban card fields (title, description, solutionSummary, status, complexity, priority, useWorktree, groupId, afterCardId). For testScenarios, use save_tests instead — update_card rejects it to protect checkbox states. For outputPaths, use save_output — it validates the file against the project folder.",
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
              description: "card_groups.id this card belongs to — the chain the board folds it into. null or \"\" removes it from its group. Get ids from list_groups; create_group makes a new one. A group is membership only: it has no status, no completion state and no date of its own, so do not treat it as an epic.",
            },
            afterCardId: {
              type: ["string", "null"],
              description: "Move this card within its chain, the same as the board's \"Move after…\": a card id or displayId from the same group puts it right behind that card, null puts it at the start. Omit to leave the order alone. With groupId in the same call, the card joins the new group first and is placed in that chain. Reordering does not bump the card's updatedAt.",
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
        description: "List kanban cards, optionally filtered by status. Returns a summary per card (title, status, complexity, priority, worktree fields) without description, solutionSummary or testScenarios — open a card with get_card for its content, or pass full: true. To find cards about a topic, use search_cards instead.",
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
            full: {
              type: "boolean",
              description: "Also return description, solutionSummary and testScenarios (with their images). Large on a big project — default false.",
            },
          },
        },
      },
      {
        name: "search_cards",
        description: `Search one project's cards for earlier decisions before you evaluate an idea or write a plan. Matches the query's words (case- and accent-insensitive) against each card's title, description, plan and AI opinion; a title match ranks higher. Returns short rows — displayId, title, status, aiVerdict, aiScore, completedAt, updatedAt and a ~240-character snippet — never the full card. Open a row with get_card when the snippet is not enough.

Reading the results: a newer decision overrides an older one (compare completedAt/updatedAt); \`withdrawn\` means the approach was tried and abandoned; \`progress\` / \`test\` are decisions still in flight.`,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "2-3 keywords from the task, space-separated. A card matches if any word matches.",
            },
            projectId: {
              type: "string",
              description: "Project to search (required) — results never cross projects, so one project's cards are not precedent for another's.",
            },
            statuses: {
              type: "array",
              items: {
                type: "string",
                enum: ["ideation", "backlog", "bugs", "progress", "test", "completed", "withdrawn"],
              },
              description: `Columns to search. Default: ${DEFAULT_SEARCH_STATUSES.join(", ")}.`,
            },
            excludeCardId: {
              type: "string",
              description: "The card you are working on (UUID or display ID), so it does not match itself.",
            },
            limit: {
              type: "number",
              description: `Maximum rows (default ${DEFAULT_SEARCH_LIMIT}, max 25).`,
            },
          },
          required: ["query", "projectId"],
        },
      },
      {
        name: "list_open_work",
        description: `List a project's unmerged work and the files each piece touches, to spot overlap before you plan. Two sources per card: \`git\` — cards with a live worktree or branch, listing the files changed since the branch left the default branch; \`plan\` — backlog/bugs/progress cards with a written plan but no branch yet, listing the files the plan's Files line names. Returns displayId, title, status, branch, source and at most ${MAX_OPEN_WORK_FILES} file paths per card — no diffs and no plan text. Pass the files your card will change as \`files\` and each row that touches one of them carries it under \`overlap\`, matched against the card's full list even past the cap; those rows come first. A project that is not a git repository only has plan rows.`,
        inputSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "Project to inspect (required).",
            },
            excludeCardId: {
              type: "string",
              description: "The card you are working on (UUID or display ID), so it is not listed against itself.",
            },
            files: {
              type: "array",
              items: { type: "string" },
              description: "Repo-relative paths your card will change (e.g. your plan's Files line). `dir/*` matches everything under dir.",
            },
          },
          required: ["projectId"],
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
              enum: ["low", "medium", "high"],
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
              type: ["string", "null"],
              description: "card_groups.id this card belongs to — the chain the board folds it into. Omit, null or \"\" for no group. Get ids from list_groups; create_group makes a new one. A group is membership only: it has no status, no completion state and no date of its own, so do not treat it as an epic.",
            },
          },
          required: ["title", "projectId"],
        },
      },
      {
        name: "save_plan",
        description: `Save a solution plan to a card. A card in Ideation, Backlog or Bugs moves to In Progress; anywhere else it stays in its column. Use this when you've completed planning a task.

NOT the exit from Ideation. A card in the \`ideation\` column has not been evaluated yet: it needs save_opinion first, then the user's yes to move_card. Calling save_plan on an ideation card skips the evaluation the user asked for and jumps the card two columns at once — check the card's column before you call this.

VOICE CONTRACT (mandatory — adapt your prose to match the project's voice):

Before drafting the plan, call get_card to read the project's voice. Voice changes ONLY the tone, never the technical content — file paths, change lists, and trade-offs MUST appear in all three voices.

- entrepreneur — Plain prose. Lead with user impact and "why". Name the files/areas that change in human terms ("the login flow, the session check"), but skip line numbers and snippets. Trade-offs in one sentence each.
- builder (default) — Plain technical paragraphs grouped by feature area. Name file paths inline. End with a short Files line. No spec bullets unless a step has 5+ sub-changes.
- engineer — Numbered spec steps with file:line scope, function/symbol names, code snippets where they clarify, and explicit trade-offs. End with a Changed Files table (| File | Change |).

AI OPINION CONTRACT (mandatory — get_card returns the card's \`aiOpinion\` and \`aiVerdict\`):

${AI_OPINION_PLANNING_RULE}

PRIOR DECISIONS (check before you draft):

${PRIOR_DECISIONS_RULE}`,
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
        description: `Save test scenarios to a card and move it to Human Test (a Completed or Withdrawn card stays where it is). Use this when you've completed implementation.

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

All three voices still produce the same Summary Verdict / Strengths / Concerns / Recommendations / Priority / Complexity / Final Score sections and the same four markers — voice changes the prose inside, not the schema.`,
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Card ID: UUID, display ID (e.g., KAN-54), or task number",
            },
            aiOpinion: {
              type: "string",
              description: "AI opinion in markdown. MUST include these sections: ## Summary Verdict ([VERDICT: strong_yes|yes|maybe|no|strong_no] — one sentence), ## Strengths (bullet points), ## Concerns (bullet points), ## Recommendations (bullet points), ## Priority ([PRIORITY: low|medium|high] — reasoning), ## Complexity ([COMPLEXITY: low|medium|high] — assessment), ## Final Score ([SCORE: X/10] — justification). The server reads the card's verdict, score, priority and complexity from these four markers and writes them itself — do not call update_card for priority or complexity. Marker values stay English in every card language. Adapt the prose inside each section to the project's voice (see tool description).",
            },
            aiVerdict: {
              type: "string",
              enum: ["positive", "negative", "maybe"],
              description: "Optional fallback, used only when the opinion names no verdict ([VERDICT:] marker or Summary Verdict word). strong_yes/yes → positive, maybe → maybe, no/strong_no → negative. Maybe stays maybe whatever the score.",
            },
          },
          required: ["id", "aiOpinion"],
        },
      },
      {
        name: "save_output",
        description: `Record a file this card's work produced. This is the file-delivery contract for a Work card: when the deliverable is a document, a draft, a note, a spreadsheet — anything written to disk — call save_output with its path once the file exists. The path is resolved against the card's project folder (a relative path is fine) and must point at an existing file under that folder. Files anywhere else (~/Desktop, /tmp, another project) are rejected, symlinks that lead outside included — write the deliverable into the project folder first. Idempotent: recording the same file twice lists it once. The card stores the path relative to the project folder and get_card returns the list as \`outputPaths\`. This tool does NOT move the card.`,
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Card ID: UUID, display ID (e.g., KAN-54), or task number",
            },
            path: {
              type: "string",
              description: "Path of the file that was written — absolute, or relative to the card's project folder.",
            },
          },
          required: ["id", "path"],
        },
      },
      {
        name: "clear_queue",
        description: "Empty the run queue: every card waiting for an autonomous run is taken out, the same as Clear in the app's queue popover. Only waiting cards go — a run already going keeps going; this is not Stop. Call it only when the user explicitly asks to clear the whole queue; to take one card out, use unqueue_card. There is no Undo here: the result lists the cleared cards in their old order, so tell the user which ones went. Whether the queue is running stays the app's call — the next card added there starts it fresh.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "list_queue",
        description: "List the run queue: the cards waiting for an autonomous run, in the order the app will start them — the order its queue popover shows. One queue serves every project; pass projectId to see one project's cards (rank stays the card's place in the whole queue). Each row: rank, id, displayId, title, status, projectId, kind (implementation = build from its plan; verify = pre-verify walk of a Human Test checklist's core flow) and runsInWorktree. Whether the queue is running or paused lives in the app's memory and cannot be read from here: runState is always \"unknown\" — do not guess it. The app's warnings about files shared with live runs are not included either; for file overlap with other open work, use list_open_work.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "Only this project's queued cards (optional)",
            },
          },
        },
      },
      {
        name: "queue_card",
        description: "Add a card to the run queue, or move one already queued. Queueing is consent to an unattended, code-writing run: never call this unless the user explicitly asked to queue this card. The app's Add to queue rules apply — a Backlog or In Progress card with a plan and no checklist yet (implementation), or a Human Test card whose checklist opens with Core flow / Temel akış and still has unticked items (pre-verify); a refusal says why and writes nothing. A queued pre-verify walks the core flow while it has unticked items, then the next group that does; scope all walks every group left in one run. What happens next is the app's call, not this tool's: if the app's queue is running, the card starts within about 10 seconds or once the run ahead of it ends; if it is paused, it waits for Resume in the app; if the app is closed, nothing starts, and the queue opens paused on the next launch. This tool cannot start, pause or resume the queue. Moving a card does not bump its updatedAt.",
        inputSchema: {
          type: "object",
          properties: {
            cardId: {
              type: "string",
              description: "Card ID: UUID, display ID (e.g., KAN-54), or task number",
            },
            afterCardId: {
              type: ["string", "null"],
              description: "Where it goes. Omit to put it last; a queued card's id or displayId puts it right behind that card; null puts it first. On a card already queued, this moves it.",
            },
            scope: {
              type: "string",
              enum: ["next", "all"],
              description: "Human Test cards only: \"next\" (default) pre-verifies the next group with unticked items; \"all\" pre-verifies every group with unticked items in one run. Only pass \"all\" when the user asked for it. Omitted on a card already queued, its scope is kept.",
            },
          },
          required: ["cardId"],
        },
      },
      {
        name: "unqueue_card",
        description: "Take one card out of the run queue, the same as Remove in the app's queue popover; the cards behind it move up. A run already going on the card is not stopped. Calling it on a card that is not queued writes nothing and says so.",
        inputSchema: {
          type: "object",
          properties: {
            cardId: {
              type: "string",
              description: "Card ID: UUID, display ID (e.g., KAN-54), or task number",
            },
          },
          required: ["cardId"],
        },
      },
      {
        name: "list_groups",
        description: "List card groups with their id, code, name and member count, plus each chain's members in chain order (displayId, title, status, position) and `next`, the first member that is neither completed nor withdrawn. A group is a chain of cards that belong to one piece of work; the board folds its cards into one row. It is membership only: no status, no completion state, no date, so do not treat it as an epic. With projectId, returns what a card in that project can join: the project's own groups plus groups not tied to any project.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "Only groups a card in this project can join (optional)",
            },
          },
        },
      },
      {
        name: "create_group",
        description: "Create a card group, then pass its id as groupId to create_card or update_card. Call list_groups first: a code already used in the same project is rejected and the error names the existing group to use instead. The code is normalised the way the app does it: uppercase letters and digits, at most 6 characters (e.g. MOBILE).",
        inputSchema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "Short code shown on the card face (required). Uppercase letters and digits, up to 6 characters.",
            },
            name: {
              type: "string",
              description: "Group heading on the board, e.g. 'Mobile app'. Defaults to the code.",
            },
            projectId: {
              type: "string",
              description: "Project the group belongs to. Omit for a group offered in every project.",
            },
            color: {
              type: "string",
              description: "Optional hex color, e.g. #22c55e. Defaults to the app picker's first color.",
            },
          },
          required: ["code"],
        },
      },
      {
        name: "update_group",
        description: "Rename a card group or change its code, color or project. Membership is changed per card with update_card's groupId, not here. Moving a group to a project is refused while it holds cards from another project; making it global (projectId null) always works.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Group id from list_groups (required)",
            },
            code: {
              type: "string",
              description: "New code: uppercase letters and digits, up to 6 characters",
            },
            name: {
              type: "string",
              description: "New group heading",
            },
            color: {
              type: ["string", "null"],
              description: "New hex color, or null to clear it",
            },
            projectId: {
              type: ["string", "null"],
              description: "Project the group belongs to, or null to offer it in every project",
            },
          },
          required: ["id"],
        },
      },
      {
        name: "delete_group",
        description: "Delete a card group, the same as the card modal's Delete. Its cards are not deleted: they stay in their columns, in no group, and lose their chain position. The answer says how many cards were released.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Group id from list_groups (required)",
            },
          },
          required: ["id"],
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
        // output_paths arrived with a migration the app may not have run yet
        // (the plugin and the app update independently), so it is selected
        // only when the column exists and reads as "none" otherwise.
        const outputPathsColumn = hasCapability(db, "outputPaths")
          ? "output_paths as outputPaths,"
          : "NULL as outputPaths,";
        const card = db.prepare(`
          SELECT
            id, title, description,
            solution_summary as solutionSummary,
            test_scenarios as testScenarios,
            ai_opinion as aiOpinion,
            ai_verdict as aiVerdict,
            ${aiScoreColumn(db)}
            status, complexity, priority,
            project_folder as projectFolder,
            project_id as projectId,
            group_id as groupId,
            task_number as taskNumber,
            git_worktree_path as gitWorktreePath,
            git_worktree_status as gitWorktreeStatus,
            use_worktree as useWorktree,
            ${outputPathsColumn}
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

        // JSON text → array; null when nothing has been recorded, matching
        // what the app's own card API returns.
        const outputPaths = parseOutputPaths(card.outputPaths);
        card.outputPaths = outputPaths.length ? outputPaths : null;

        // Where the card sits in its chain, next to groupId. Left off
        // entirely for a card in no group, so that JSON reads as before.
        const chain = getChainForCard(db, card);
        if (chain) {
          (card as unknown as { chain: typeof chain }).chain = chain;
        }

        // Attach the project's voice and mode so the calling AI can match
        // its tone — and knows whether this is a Work card — without a
        // second tool call. SELECT * rather than naming `mode`: a plugin
        // newer than the app can meet a DB from before that column existed,
        // and an absent column reads as development, the mode every project
        // had until then. Voice defaults to 'builder' when missing.
        const projectRow = card.projectId
          ? (db.prepare(`SELECT * FROM projects WHERE id = ?`).get(card.projectId) as
              | { voice?: string | null; mode?: string | null }
              | undefined)
          : undefined;
        const voice = (projectRow?.voice ?? "builder") as "entrepreneur" | "builder" | "engineer";
        (card as unknown as { project: { voice: string; mode: string } }).project = {
          voice,
          mode: normalizeProjectMode(projectRow?.mode),
        };

        // Extract images from HTML fields
        const { cleanedCard, images } = extractCardImages(card);

        // Build content array
        const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [
          { type: "text", text: JSON.stringify(cleanedCard, null, 2) }
        ];

        // A session the user opened by hand never sees Ideafy's planning
        // prompts, so the opinion rule travels with the card itself. Its own
        // block, so content[0] stays plain JSON for anything that parses it.
        const planningNote = buildOpinionPlanningNote(card);
        if (planningNote) {
          content.push({ type: "text", text: planningNote });
        }
        const priorDecisionsNote = buildPriorDecisionsNote(card);
        if (priorDecisionsNote) {
          content.push({ type: "text", text: priorDecisionsNote });
        }
        const chainImplementationNote = buildChainImplementationNote(card, chain);
        if (chainImplementationNote) {
          content.push({ type: "text", text: chainImplementationNote });
        }

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
        const { id: rawId, afterCardId: rawAfterCardId, ...updates } = args as {
          id: string;
          afterCardId?: string | null;
        } & Partial<Card>;
        const id = resolveCardId(rawId);
        if (!id) {
          return {
            content: [{ type: "text", text: `Card not found: ${rawId}` }],
            isError: true,
          };
        }

        // Not a column: it rewrites the chain's order, so it stays out of
        // fieldMap and is resolved here — a displayId works as well as a UUID.
        let afterCardId: string | null | undefined = rawAfterCardId;
        if (typeof rawAfterCardId === "string") {
          afterCardId = resolveCardId(rawAfterCardId);
          if (!afterCardId) {
            return {
              content: [{ type: "text", text: `afterCardId not found: ${rawAfterCardId}` }],
              isError: true,
            };
          }
        }
        const reorder = afterCardId !== undefined;

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
                `Accepted fields: ${[...Object.keys(fieldMap), "afterCardId"].join(", ")}. ` +
                `For testScenarios use save_tests; for aiOpinion use save_opinion; for outputPaths use save_output; ` +
                `for the run queue use queue_card / unqueue_card.`,
            }],
            isError: true,
          };
        }

        if (updates.title !== undefined) {
          assertValidCardTitle(updates.title);
        }

        if (updates.complexity !== undefined) {
          const stored = normalizeComplexity(updates.complexity);
          if (!stored) {
            return {
              content: [{ type: "text", text: `update_card: complexity must be low, medium or high (got "${updates.complexity}").` }],
              isError: true,
            };
          }
          updates.complexity = stored;
        }

        // The SDK does not enforce the schema's enum (see move_card): an
        // unlisted value would be written and the card would leave every column.
        if (updates.status !== undefined && !isStatus(updates.status)) {
          return {
            content: [{
              type: "text",
              text: `update_card: "${updates.status}" is not a column. Valid columns: ${STATUSES.join(", ")}.`,
            }],
            isError: true,
          };
        }

        // "" means "no group" here as in the app's PUT: one rule for both.
        if (updates.groupId !== undefined) {
          updates.groupId = normalizeGroupId(updates.groupId) ?? null;
        }
        if (updates.groupId !== undefined) {
          const owner = db
            .prepare(`SELECT project_id FROM cards WHERE id = ?`)
            .get(id) as { project_id: string | null } | undefined;
          assertGroupAssignable(db, updates.groupId, owner?.project_id ?? null);
        }

        const now = new Date().toISOString();
        const setClauses: string[] = ["updated_at = ?"];
        const values: unknown[] = [now];

        for (const [key, value] of Object.entries(updates)) {
          if (fieldMap[key] && value !== undefined) {
            setClauses.push(`${fieldMap[key]} = ?`);
            // Convert markdown to HTML for rich text fields
            if (markdownFields.includes(key) && typeof value === "string") {
              const htmlValue = markdownToTiptapHtml(value);
              values.push(
                key === "solutionSummary"
                  ? linkCardsInHtml(db, htmlValue, updates.projectId ?? projectIdOfCard(db, id))
                  : htmlValue
              );
            } else if (key === "useWorktree") {
              // SQLite integer column: true/false → 1/0, null passes through
              values.push(serializeUseWorktreeForDb(value as boolean | null));
            } else {
              values.push(value);
            }
          }
        }

        // completed_at follows the status the same way move_card and the
        // app's PUT route keep it — lib/card-ops' completedAtFor, computed
        // from the stored status inside the transaction below.
        const writesStatus = typeof updates.status === "string";
        if (writesStatus && !hasCapability(db, "completedAt")) {
          return {
            content: [{ type: "text", text: missingCapabilityMessage("update_card", "completedAt") }],
            isError: true,
          };
        }

        // Only `updated_at` in the SET list means the caller passed an id and
        // nothing else. Bumping the timestamp and calling it an update is the
        // same silent no-op as above, one step further along. A reorder alone
        // is an update, but one that must not touch updated_at: the Stale row
        // measures age from it, and moving a card in its chain is not work.
        const writeFields = setClauses.length > 1;
        if (!writeFields && !reorder) {
          return {
            content: [{
              type: "text",
              text: `update_card: nothing to update — no accepted field was provided for card ${id}.`,
            }],
            isError: true,
          };
        }

        // One transaction: groupId is written first (0016's trigger clears
        // the old position), then the order is computed in the new chain. A
        // rejected afterCardId rolls the field writes back with it.
        const outcome = transaction(db, () => {
          if (writeFields) {
            if (writesStatus) {
              const current = db
                .prepare(`SELECT status, completed_at FROM cards WHERE id = ?`)
                .get(id) as { status: string; completed_at: string | null } | undefined;
              if (!current) return null;
              setClauses.push("completed_at = ?");
              values.push(
                completedAtFor(current.status, updates.status as string, current.completed_at, now)
              );
            }
            const result = db.prepare(`
              UPDATE cards SET ${setClauses.join(", ")} WHERE id = ?
            `).run(...values, id);
            if (Number(result.changes) === 0) return null;
          }
          return {
            placed: reorder ? moveCardInChain(db, id, afterCardId ?? null) : null,
          };
        });

        if (!outcome) {
          return {
            content: [{ type: "text", text: `Card not found: ${id}` }],
            isError: true,
          };
        }

        const written = Object.keys(updates).filter((key) => key in fieldMap);
        if (reorder) written.push("afterCardId");
        const placedNote = !outcome.placed
          ? ""
          : outcome.placed.changed
            ? ` Chain position ${outcome.placed.position}/${outcome.placed.total}.`
            : ` Already at chain position ${outcome.placed.position}/${outcome.placed.total}; the order was not rewritten.`;
        return {
          content: [{
            type: "text",
            text: `Card ${id} updated (${written.join(", ")}).${placedNote} Card is in "${readStatus(id)}".`,
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

        if (!hasCapability(db, "completedAt")) {
          return {
            content: [{ type: "text", text: missingCapabilityMessage("move_card", "completedAt") }],
            isError: true,
          };
        }

        // The same move the app makes: lib/card-ops/move-card.ts.
        const moved = moveCard(db, id, status, new Date().toISOString());
        if (!moved.ok) {
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
        const { status, projectId, full } = args as {
          status?: Status;
          projectId?: string;
          full?: boolean;
        };

        // The content fields dominate the payload — on a project with a few
        // hundred cards they run to megabytes — so the default is a summary
        // and get_card is where a card's content is read.
        const contentColumns = full
          ? `description,
            solution_summary as solutionSummary,
            test_scenarios as testScenarios,`
          : "";

        let query = `
          SELECT
            id, title, ${contentColumns}
            ${aiScoreColumn(db)}
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

        if (!full) {
          return {
            content: [{ type: "text", text: JSON.stringify(cards, null, 2) }],
          };
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

      case "search_cards": {
        const { query, projectId, statuses, excludeCardId, limit } = args as {
          query: string;
          projectId: string;
          statuses?: string[];
          excludeCardId?: string;
          limit?: number;
        };
        if (!query?.trim() || !projectId) {
          return {
            content: [{ type: "text", text: "search_cards needs a query and a projectId." }],
            isError: true,
          };
        }
        const unknown = (statuses ?? []).filter((s) => !STATUSES.includes(s as Status));
        if (unknown.length) {
          return {
            content: [{ type: "text", text: `Unknown status: ${unknown.join(", ")}. Use one of: ${STATUSES.join(", ")}.` }],
            isError: true,
          };
        }

        const results = searchCards(db, {
          query,
          projectId,
          statuses,
          excludeCardId: excludeCardId ? resolveCardId(excludeCardId) : null,
          limit,
        });
        return {
          content: [{
            type: "text",
            text: results.length
              ? JSON.stringify(results, null, 2)
              : `No cards in this project match "${query}".`,
          }],
        };
      }

      case "list_open_work": {
        const { projectId, excludeCardId, files } = args as {
          projectId: string;
          excludeCardId?: string;
          files?: string[];
        };
        if (!projectId) {
          return {
            content: [{ type: "text", text: "list_open_work needs a projectId." }],
            isError: true,
          };
        }

        const rows = await listOpenWork(
          db,
          {
            projectId,
            excludeCardId: excludeCardId ? resolveCardId(excludeCardId) : null,
            files: Array.isArray(files) ? files.filter((f) => typeof f === "string") : null,
          },
          { isGitRepo, changedFiles: listChangedFiles }
        );
        return {
          content: [{
            type: "text",
            text: rows.length
              ? JSON.stringify(rows, null, 2)
              : "No open work with known files in this project.",
          }],
        };
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
          groupId: rawGroupId = null,
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
        if (!isStatus(status)) {
          return {
            content: [{
              type: "text",
              text: `create_card: "${status}" is not a column. Valid columns: ${STATUSES.join(", ")}.`,
            }],
            isError: true,
          };
        }
        // A card created straight into Completed carries its finish date, as
        // one the app creates does (lib/card-ops completedAtOnCreate).
        if (status === "completed" && !hasCapability(db, "completedAt")) {
          return {
            content: [{ type: "text", text: missingCapabilityMessage("create_card", "completedAt") }],
            isError: true,
          };
        }
        const groupId = normalizeGroupId(rawGroupId) ?? null;
        assertGroupAssignable(db, groupId, projectId);
        // Callers that learned the old simple/complex enum still land on the
        // card's three levels; anything unreadable is an error, not a guess.
        const storedComplexity = normalizeComplexity(complexity);
        if (!storedComplexity) {
          return {
            content: [{ type: "text", text: `create_card: complexity must be low, medium or high (got "${complexity}").` }],
            isError: true,
          };
        }

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
        // completed_at goes in only when the card starts finished, so a
        // database without the column still takes every other create.
        const completedAt = completedAtOnCreate(status, now);
        db.prepare(`
          INSERT INTO cards (
            id, title, description, solution_summary, test_scenarios,
            status, complexity, priority, project_folder, project_id,
            group_id, task_number, created_at, updated_at${completedAt ? ", completed_at" : ""}
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${completedAt ? ", ?" : ""})
        `).run(
          cardId,
          title,
          markdownToTiptapHtml(description),
          linkCardsInHtml(db, markdownToTiptapHtml(solutionSummary), projectId),
          "", // Test scenarios added after implementation via save_tests
          status,
          storedComplexity,
          priority,
          projectFolder,
          projectId,
          groupId,
          taskNumber,
          now,
          now,
          ...(completedAt ? [completedAt] : [])
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

        // Convert markdown to Tiptap-compatible HTML with TaskList support;
        // "IDE-318" in Edge Cases becomes a clickable [[ chip.
        const htmlContent = linkCardsInHtml(db, markdownToTiptapHtml(solutionSummary), projectIdOfCard(db, id));

        // The plan and the column move land together. Which column, and its
        // completed_at, come from lib/card-ops — the rule the app's Apply uses.
        if (!hasCapability(db, "completedAt")) {
          return {
            content: [{ type: "text", text: missingCapabilityMessage("save_plan", "completedAt") }],
            isError: true,
          };
        }
        const saved = saveFieldAndMove(id, "solution_summary", htmlContent, statusAfterPlan);
        if (!saved) {
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

        if (!hasCapability(db, "completedAt")) {
          return {
            content: [{ type: "text", text: missingCapabilityMessage("save_tests", "completedAt") }],
            isError: true,
          };
        }
        const saved = saveFieldAndMove(id, "test_scenarios", mergedHtml, statusAfterTests);
        if (!saved) {
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
        const { id: rawId, aiOpinion, aiVerdict } = args as {
          id: string;
          aiOpinion: string;
          aiVerdict?: "positive" | "negative" | "maybe";
        };
        const id = resolveCardId(rawId);
        if (!id) {
          return {
            content: [{ type: "text", text: `Card not found: ${rawId}` }],
            isError: true,
          };
        }

        // saveOpinion writes ai_score; an app that has not run 0021 yet cannot
        // take it, and half-writing the opinion without its score would leave
        // the card different from one evaluated in the app.
        if (!hasCapability(db, "aiScore")) {
          return {
            content: [{ type: "text", text: missingCapabilityMessage("save_opinion", "aiScore") }],
            isError: true,
          };
        }

        // Convert markdown to Tiptap-compatible HTML; "IDE-318" under Related
        // Cards becomes a clickable [[ chip.
        const htmlContent = linkCardsInHtml(db, markdownToTiptapHtml(aiOpinion), projectIdOfCard(db, id));

        // Verdict, score, priority and complexity are read from the opinion's
        // markers, as Evaluate and Apply do; the aiVerdict argument only fills
        // in when the text names no verdict.
        const result = saveOpinion(db, {
          id,
          html: htmlContent,
          source: aiOpinion,
          fallbackVerdict: aiVerdict ?? null,
          now: new Date().toISOString(),
        });

        if (!result.ok) {
          return {
            content: [{ type: "text", text: `Card not found: ${id}` }],
            isError: true,
          };
        }

        return {
          content: [{
            type: "text",
            text: `AI opinion saved to card ${id} (${describeOpinionMarkers(result) || "no verdict or score read"}). ` +
              `Card is still in "${readStatus(id)}" — this tool does not move cards. ` +
              `Ask the user before calling move_card.`,
          }],
        };
      }

      case "save_output": {
        const { id: rawId, path: rawPath } = args as { id: string; path: string };
        const id = resolveCardId(rawId);
        if (!id) {
          return {
            content: [{ type: "text", text: `Card not found: ${rawId}` }],
            isError: true,
          };
        }

        // Every check — column present, file exists, inside the project
        // folder with symlinks resolved — lives in recordOutputPath and
        // surfaces as an OutputPathError that says what to do; the catch
        // below turns it into an isError result like every other handler.
        const outcome = recordOutputPath(db, id, rawPath);

        const listed = `${outcome.outputPaths.length} output(s) on the card: ${outcome.outputPaths.join(", ")}.`;
        const summary = outcome.alreadyRecorded
          ? `Already recorded on card ${id}: ${outcome.relativePath} (${outcome.absolutePath}) — nothing changed.`
          : `Output recorded on card ${id}: ${outcome.relativePath} (${outcome.absolutePath}).`;

        return {
          content: [{
            type: "text",
            text: `${summary} ${listed} Card is in "${readStatus(id)}" — save_output does not move cards.`,
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
                // SELECT * rather than naming `mode`: a plugin newer than the
                // app can meet a DB from before that column existed.
                `SELECT *, folder_path as folderPath, id_prefix as idPrefix,
                   use_worktrees as useWorktrees
                 FROM projects WHERE id = ?`
              )
              .get(card.projectId) as
              | {
                  id: string;
                  folderPath: string;
                  idPrefix: string;
                  useWorktrees: number | null;
                  mode?: string | null;
                }
              | undefined)
          : undefined;

        const cardUseWorktree = normalizeUseWorktree(card.useWorktree);
        const projectUseWorktrees = project
          ? Boolean(project.useWorktrees ?? 1)
          : null;
        const effective = shouldUseWorktree(
          { useWorktree: cardUseWorktree },
          project ? { useWorktrees: projectUseWorktrees, mode: project.mode } : null
        );

        if (!effective) {
          // Distinguish whether the disable came from the card override or
          // the project default — the previous wording always blamed the
          // card, which was misleading when the card was set to "follow
          // project" and the project itself had worktrees turned off.
          const reason =
            project?.mode === "work"
              ? "This card's project is a Work project; Work cards never get a branch."
              : cardUseWorktree === false
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
                // SELECT * for the same reason as ensure_branch: `mode` may
                // not exist yet on a DB the app has not migrated.
                `SELECT *, id_prefix as idPrefix, use_worktrees as useWorktrees FROM projects WHERE id = ?`
              )
              .get(card.projectId) as
              | { idPrefix: string; useWorktrees: number; mode?: string | null }
              | undefined)
          : undefined;

        // A Work card gets the policy without the git-only clauses; an
        // absent column (older app) reads as development.
        const mode = normalizeProjectMode(project?.mode);

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
                  ? {
                      useWorktrees: project.useWorktrees === 1,
                      idPrefix: project.idPrefix,
                      mode: project.mode,
                    }
                  : null
              )
            : undefined,
          mode
        );

        const bound = `Session ${sessionId} bound to card ${card.id} ("${card.title}", column: ${card.status}, project mode: ${mode}).`;

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

      case "clear_queue": {
        if (!hasCapability(db, "queuePosition")) {
          return {
            content: [{ type: "text", text: missingCapabilityMessage("clear_queue", "queuePosition") }],
            isError: true,
          };
        }
        // The same clear the app makes: lib/card-ops/queue.ts. The app sees
        // the empty queue on its next 10s poll.
        const cleared = clearQueue(db);
        return {
          content: [{
            type: "text",
            text: cleared.length === 0
              ? "The run queue was already empty."
              : `Cleared ${cleared.length} card(s) from the run queue, in their old order: ${cleared.map((c) => c.displayId).join(", ")}. A run already going was not touched.`,
          }],
        };
      }

      case "list_queue": {
        if (!hasCapability(db, "queueVerifyScope")) {
          return {
            content: [{ type: "text", text: missingCapabilityMessage("list_queue", "queueVerifyScope") }],
            isError: true,
          };
        }
        const { projectId } = (args ?? {}) as { projectId?: string };
        const items = listQueueRows(db)
          .map((row, index) => ({
            rank: index + 1,
            id: row.id,
            displayId: queueDisplayId(row),
            title: row.title,
            status: row.status,
            projectId: row.projectId,
            kind: queueKindOf(row),
            ...(queueKindOf(row) === "verify" ? { verifyScope: row.queueVerifyScope ?? "next" } : {}),
            runsInWorktree: queuedRunsInWorktree(row),
          }))
          .filter((item) => !projectId || item.projectId === projectId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(
              {
                runState: "unknown",
                note: "Whether the queue is running or paused lives in the Ideafy app; a terminal cannot see it. The app shows it in its queue popover.",
                items,
              },
              null,
              2
            ),
          }],
        };
      }

      case "queue_card": {
        if (!hasCapability(db, "queueVerifyScope")) {
          return {
            content: [{ type: "text", text: missingCapabilityMessage("queue_card", "queueVerifyScope") }],
            isError: true,
          };
        }
        const { cardId: rawCardId, afterCardId: rawAfterCardId, scope: rawScope } = args as {
          cardId: string;
          afterCardId?: string | null;
          scope?: string;
        };
        if (rawScope !== undefined && rawScope !== "next" && rawScope !== "all") {
          return { content: [{ type: "text", text: `queue_card: scope must be "next" or "all". Nothing was written.` }], isError: true };
        }
        const cardId = resolveCardId(rawCardId);
        if (!cardId) {
          return { content: [{ type: "text", text: `Card not found: ${rawCardId}` }], isError: true };
        }
        let afterCardId: string | null | undefined = rawAfterCardId;
        if (typeof rawAfterCardId === "string") {
          afterCardId = resolveCardId(rawAfterCardId);
          if (!afterCardId) {
            return { content: [{ type: "text", text: `afterCardId not found: ${rawAfterCardId}` }], isError: true };
          }
        }
        // The same write the app's Add to queue makes: lib/card-ops/queue.ts.
        // The app picks it up on its next 10s poll of the queue.
        const result = enqueueCard(db, cardId, afterCardId, rawScope);
        if (!result.ok) {
          return { content: [{ type: "text", text: `queue_card: ${result.message}. Nothing was written.` }], isError: true };
        }
        const total = listQueueRows(db).length;
        const name = queueDisplayId(result.row);
        return {
          content: [{
            type: "text",
            text:
              `${name} ${result.moved ? "moved to" : "queued at"} #${result.rank} of ${total} in the run queue. ` +
              "It starts only through the Ideafy app: within about 10 seconds or after the run ahead if the app's queue is running, " +
              "on Resume if it is paused, and not at all while the app is closed.",
          }],
        };
      }

      case "unqueue_card": {
        if (!hasCapability(db, "queueVerifyScope")) {
          return {
            content: [{ type: "text", text: missingCapabilityMessage("unqueue_card", "queueVerifyScope") }],
            isError: true,
          };
        }
        const { cardId: rawCardId } = args as { cardId: string };
        const cardId = resolveCardId(rawCardId);
        if (!cardId) {
          return { content: [{ type: "text", text: `Card not found: ${rawCardId}` }], isError: true };
        }
        const removed = dequeueCard(db, cardId);
        return {
          content: [{
            type: "text",
            text: removed
              ? `${rawCardId} was taken out of the run queue. A run already going on it was not touched.`
              : `${rawCardId} was not in the run queue. Nothing was written.`,
          }],
        };
      }

      case "list_groups": {
        const { projectId } = (args ?? {}) as { projectId?: string };
        const groups = listGroupsWithChains(db, projectId);
        return {
          content: [{ type: "text", text: JSON.stringify(groups, null, 2) }],
        };
      }

      case "create_group": {
        const input = args as { code: string; name?: string; projectId?: string; color?: string };
        const group = createGroup(db, input);
        return {
          content: [{
            type: "text",
            text: `Group created: ${group.id} (${group.code} · ${group.name}). Pass this id as groupId to create_card or update_card.`,
          }],
        };
      }

      case "update_group": {
        const { id, ...updates } = args as {
          id: string;
          code?: string;
          name?: string;
          color?: string | null;
          projectId?: string | null;
        };
        // The app's Save may send an unchanged form and get the row back; an
        // agent that calls with nothing to change has lost track of something,
        // the same guard update_card has.
        if (Object.values(updates).every((value) => value === undefined)) {
          return {
            content: [{
              type: "text",
              text: `update_group: nothing to update for group ${id}. Pass code, name, color or projectId.`,
            }],
            isError: true,
          };
        }
        const group = updateGroup(db, id, updates);
        return {
          content: [{ type: "text", text: `Group ${group.id} updated: ${group.code} · ${group.name}.` }],
        };
      }

      case "delete_group": {
        const { id } = args as { id: string };
        const { group, releasedCards } = deleteGroup(db, id);
        return {
          content: [{
            type: "text",
            text: `Group ${group.code} · ${group.name} deleted. ${releasedCards} card(s) released: they keep their columns and are in no group now.`,
          }],
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
