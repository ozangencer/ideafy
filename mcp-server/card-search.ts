import type { Db } from "./db.js";
import { existsSync } from "fs";
import {
  extractPlanFiles,
  htmlToText,
  normalizePath,
  pathsOverlap,
} from "./shared.js";
import { hasCapability } from "./schema-caps.js";

export { extractPlanFiles, htmlToText };

// search_cards and list_open_work: the two lookups behind the "check prior
// decisions" rule (lib/prompts/prior-decisions.ts). Both return short rows —
// never a card's full HTML, a diff or a plan body — so a model can afford to
// call them on every evaluation and plan, and open the one card that matters
// with get_card.

// ============================================================================
// Text helpers
// ============================================================================

// Case- and accent-insensitive, one output character per input code unit so
// an index found in the folded text is also an index into the original — the
// snippet is cut from the original. The Turkish locale gets İ → i right; ı is
// then folded to i as well, otherwise an English "Image" lowered under tr
// ("ımage") would never match the query "image". Accents drop so a query typed
// without Turkish characters ("sema") still finds "şema".
const foldCache = new Map<string, string>();

function foldChar(c: string): string {
  let ch = foldCache.get(c);
  if (ch === undefined) {
    const lower = c.toLocaleLowerCase("tr");
    const bare = lower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    ch = bare.length === 1 ? bare : lower.length === 1 ? lower : c;
    if (ch === "ı") ch = "i";
    foldCache.set(c, ch);
  }
  return ch;
}

export function foldText(text: string): string {
  const out: string[] = new Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = foldChar(text[i]);
  return out.join("");
}

function queryTerms(query: string): string[] {
  const terms = foldText(query)
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((t) => t.length > 0);
  return Array.from(new Set(terms));
}

const SNIPPET_LENGTH = 240;
const SNIPPET_LEAD = 80;

function snippetAround(text: string, at: number): string {
  const start = Math.max(0, at - SNIPPET_LEAD);
  const end = Math.min(text.length, start + SNIPPET_LENGTH);
  const body = text.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

function projectPrefix(db: Db, projectId: string): string | null {
  const row = db
    .prepare(`SELECT id_prefix as idPrefix FROM projects WHERE id = ?`)
    .get(projectId) as { idPrefix: string | null } | undefined;
  return row?.idPrefix ?? null;
}

function displayIdFor(prefix: string | null, taskNumber: number | null): string | null {
  return prefix && taskNumber != null ? `${prefix}-${taskNumber}` : null;
}

// ============================================================================
// search_cards
// ============================================================================

// Decided or in flight. Ideation and backlog are ideas nobody has committed
// to yet, so they are not precedent unless the caller asks for them.
export const DEFAULT_SEARCH_STATUSES = ["completed", "withdrawn", "progress", "test"] as const;
export const DEFAULT_SEARCH_LIMIT = 8;
const MAX_SEARCH_LIMIT = 25;

// A term in the title says the card is about it; one in the body may be a
// passing mention.
const TITLE_WEIGHT = 3;
const BODY_WEIGHT = 1;

export interface CardSearchResult {
  id: string;
  displayId: string | null;
  title: string;
  status: string;
  aiVerdict: string | null;
  completedAt: string | null;
  updatedAt: string;
  snippet: string;
}

export function searchCards(
  db: Db,
  opts: {
    query: string;
    projectId: string;
    statuses?: string[];
    excludeCardId?: string | null;
    limit?: number;
  }
): CardSearchResult[] {
  const terms = queryTerms(opts.query);
  if (terms.length === 0) return [];

  const statuses = opts.statuses?.length ? opts.statuses : [...DEFAULT_SEARCH_STATUSES];
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? DEFAULT_SEARCH_LIMIT)), MAX_SEARCH_LIMIT);
  // completed_at came with a migration; the plugin can be newer than the app.
  const completedAt = hasCapability(db, "completedAt") ? "completed_at" : "NULL";

  const rows = db
    .prepare(
      `SELECT id, title, status, task_number as taskNumber,
              ai_verdict as aiVerdict, ${completedAt} as completedAt,
              updated_at as updatedAt, description,
              solution_summary as solutionSummary, ai_opinion as aiOpinion
         FROM cards
        WHERE project_id = ?
          AND status IN (${statuses.map(() => "?").join(", ")})
          AND id != ?`
    )
    .all(opts.projectId, ...statuses, opts.excludeCardId ?? "") as Array<{
    id: string;
    title: string;
    status: string;
    taskNumber: number | null;
    aiVerdict: string | null;
    completedAt: string | null;
    updatedAt: string;
    description: string | null;
    solutionSummary: string | null;
    aiOpinion: string | null;
  }>;

  const prefix = projectPrefix(db, opts.projectId);
  const scored: Array<{ score: number; result: CardSearchResult }> = [];

  for (const row of rows) {
    const title = htmlToText(row.title);
    const foldedTitle = foldText(title);
    // Snippet priority: the opinion carries the verdict and the reasoning, the
    // plan the chosen approach, the description only the ask.
    const bodies = [row.aiOpinion, row.solutionSummary, row.description]
      .map((html) => htmlToText(html).replace(/\s+/g, " "))
      .filter((text) => text.length > 0);
    const foldedBodies = bodies.map(foldText);

    let score = 0;
    for (const term of terms) {
      if (foldedTitle.includes(term)) score += TITLE_WEIGHT;
      if (foldedBodies.some((body) => body.includes(term))) score += BODY_WEIGHT;
    }
    if (score === 0) continue;

    let snippet = "";
    for (let i = 0; i < bodies.length && !snippet; i++) {
      const hits = terms
        .map((term) => foldedBodies[i].indexOf(term))
        .filter((at) => at !== -1);
      if (hits.length) snippet = snippetAround(bodies[i], Math.min(...hits));
    }
    if (!snippet && bodies.length) snippet = snippetAround(bodies[0], 0);

    scored.push({
      score,
      result: {
        id: row.id,
        displayId: displayIdFor(prefix, row.taskNumber),
        title,
        status: row.status,
        aiVerdict: row.aiVerdict,
        completedAt: row.completedAt,
        updatedAt: row.updatedAt,
        snippet,
      },
    });
  }

  scored.sort(
    (a, b) => b.score - a.score || b.result.updatedAt.localeCompare(a.result.updatedAt)
  );
  return scored.slice(0, limit).map((s) => s.result);
}

// ============================================================================
// list_open_work
// ============================================================================

export const MAX_OPEN_WORK_FILES = 40;

// The caller's files that a card also touches, matched against the card's full
// file list — not the capped one it gets back. A 52-file branch otherwise hides
// its overlap past the cap, and alphabetical order puts mcp-server/ and lib/
// right where the cut falls.
function findOverlap(cardFiles: string[], callerFiles: string[]): string[] {
  const card = cardFiles.map(normalizePath);
  return callerFiles.filter((f) => card.some((c) => pathsOverlap(c, f)));
}

// Columns where work can still be unmerged. Human Test only counts while it
// still has a live branch or worktree; its plan alone says nothing about what
// is left.
const OPEN_STATUSES = ["backlog", "bugs", "progress", "test"];
const PLAN_STATUSES = new Set(["backlog", "bugs", "progress"]);

export interface OpenWorkRow {
  id: string;
  displayId: string | null;
  title: string;
  status: string;
  branch: string | null;
  source: "git" | "plan";
  files: string[];
  moreFiles?: number;
  overlap?: string[];
}

export type ChangedFilesFn = (
  repoPath: string,
  opts: { worktreePath?: string | null; branchName?: string | null }
) => Promise<string[]>;

export async function listOpenWork(
  db: Db,
  opts: { projectId: string; excludeCardId?: string | null; files?: string[] | null },
  deps: {
    isGitRepo: (cwd: string) => Promise<boolean>;
    changedFiles: ChangedFilesFn;
    pathExists?: (path: string) => boolean;
  }
): Promise<OpenWorkRow[]> {
  const pathExists = deps.pathExists ?? existsSync;
  const project = db
    .prepare(`SELECT folder_path as folderPath, id_prefix as idPrefix FROM projects WHERE id = ?`)
    .get(opts.projectId) as { folderPath: string | null; idPrefix: string | null } | undefined;
  if (!project) return [];

  const hasBranchColumns = hasCapability(db, "branchStatus");
  const rows = db
    .prepare(
      `SELECT id, title, status, task_number as taskNumber,
              solution_summary as solutionSummary,
              git_worktree_path as gitWorktreePath,
              git_worktree_status as gitWorktreeStatus,
              ${hasBranchColumns ? "git_branch_name" : "NULL"} as gitBranchName,
              ${hasBranchColumns ? "git_branch_status" : "NULL"} as gitBranchStatus
         FROM cards
        WHERE project_id = ?
          AND status IN (${OPEN_STATUSES.map(() => "?").join(", ")})
          AND id != ?
        ORDER BY updated_at DESC`
    )
    .all(opts.projectId, ...OPEN_STATUSES, opts.excludeCardId ?? "") as Array<{
    id: string;
    title: string;
    status: string;
    taskNumber: number | null;
    solutionSummary: string | null;
    gitWorktreePath: string | null;
    gitWorktreeStatus: string | null;
    gitBranchName: string | null;
    gitBranchStatus: string | null;
  }>;

  // A Work project has no repository; its open work is whatever the plans say.
  const repoPath = project.folderPath;
  const inGit = repoPath ? await deps.isGitRepo(repoPath) : false;

  const callerFiles = Array.from(
    new Set((opts.files ?? []).map(normalizePath).filter(Boolean))
  );

  const result: OpenWorkRow[] = [];
  for (const row of rows) {
    const base = {
      id: row.id,
      displayId: displayIdFor(project.idPrefix, row.taskNumber),
      title: htmlToText(row.title),
      status: row.status,
    };

    let files: string[] = [];
    let source: OpenWorkRow["source"] = "git";
    let branch: string | null = null;

    if (inGit && repoPath && row.gitWorktreeStatus === "active" && row.gitWorktreePath) {
      // The row still says active but the directory is gone: stale state, not
      // work anyone can overlap with. Skip it quietly.
      if (!pathExists(row.gitWorktreePath)) continue;
      files = await deps.changedFiles(repoPath, { worktreePath: row.gitWorktreePath });
      branch = row.gitBranchName;
    } else if (inGit && repoPath && row.gitBranchStatus === "active" && row.gitBranchName) {
      files = await deps.changedFiles(repoPath, { branchName: row.gitBranchName });
      branch = row.gitBranchName;
    }

    // A branch with no commits yet says nothing; the plan still does.
    if (files.length === 0 && PLAN_STATUSES.has(row.status)) {
      files = extractPlanFiles(row.solutionSummary);
      source = "plan";
    }
    if (files.length === 0) continue;

    const entry: OpenWorkRow = {
      ...base,
      branch,
      source,
      files: files.slice(0, MAX_OPEN_WORK_FILES),
    };
    if (files.length > MAX_OPEN_WORK_FILES) entry.moreFiles = files.length - MAX_OPEN_WORK_FILES;
    if (callerFiles.length) {
      const overlap = findOverlap(files, callerFiles);
      if (overlap.length) entry.overlap = overlap;
    }
    result.push(entry);
  }
  // Overlapping cards first, so the rows that matter lead the answer.
  if (callerFiles.length) {
    result.sort((a, b) => Number(Boolean(b.overlap)) - Number(Boolean(a.overlap)));
  }
  return result;
}
