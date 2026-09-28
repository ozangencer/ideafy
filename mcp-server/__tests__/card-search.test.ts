import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import {
  extractPlanFiles,
  foldText,
  htmlToText,
  listOpenWork,
  MAX_OPEN_WORK_FILES,
  searchCards,
} from "../card-search.js";
import { buildPriorDecisionsNote } from "../serialize-card.js";
import * as priorNs from "../../lib/prompts/prior-decisions";

/** See run-output.test.ts — `lib/` comes back through the CJS interop. */
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { PRIOR_DECISIONS_RULE, PRIOR_DECISIONS_EVALUATION_RULE } = interop(priorNs);

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, id_prefix TEXT, folder_path TEXT);
    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      solution_summary TEXT DEFAULT '',
      ai_opinion TEXT,
      ai_verdict TEXT,
      status TEXT NOT NULL,
      project_id TEXT,
      task_number INTEGER,
      git_worktree_path TEXT,
      git_worktree_status TEXT,
      git_branch_name TEXT,
      git_branch_status TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
    INSERT INTO projects VALUES ('p1', 'IDE', '/repo'), ('p2', 'WRK', NULL);
  `);
  return db;
}

type CardSeed = Partial<{
  title: string;
  description: string;
  solution: string;
  opinion: string;
  status: string;
  project: string;
  n: number;
  updated: string;
  worktreePath: string;
  worktreeStatus: string;
  branch: string;
  branchStatus: string;
}>;

function addCard(db: Database.Database, id: string, c: CardSeed) {
  db.prepare(
    `INSERT INTO cards (id, title, description, solution_summary, ai_opinion, status,
       project_id, task_number, git_worktree_path, git_worktree_status,
       git_branch_name, git_branch_status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    c.title ?? id,
    c.description ?? "",
    c.solution ?? "",
    c.opinion ?? null,
    c.status ?? "completed",
    c.project ?? "p1",
    c.n ?? null,
    c.worktreePath ?? null,
    c.worktreeStatus ?? null,
    c.branch ?? null,
    c.branchStatus ?? null,
    c.updated ?? "2026-09-01T00:00:00Z"
  );
}

// ---------------------------------------------------------------------------
// search_cards
// ---------------------------------------------------------------------------

test("folding is case- and accent-insensitive and keeps indexes aligned", () => {
  assert.equal(foldText("Şema İyi"), "sema iyi");
  // Lowered under tr, "I" becomes "ı" — folded back so English words match.
  assert.equal(foldText("Image"), "image");
  const text = "Önce Şema";
  assert.equal(foldText(text).length, text.length);
});

test("a title hit outranks a body hit, and the snippet comes from the opinion first", () => {
  const db = makeDb();
  addCard(db, "a", { n: 1, title: "Unrelated", description: "<p>we touched the şema once</p>" });
  addCard(db, "b", {
    n: 2,
    title: "Şema migration",
    description: "<p>desc mentions schema</p>",
    opinion: "<p>Verdict: keep one şema file.</p>",
  });

  const results = searchCards(db, { query: "sema", projectId: "p1" });

  assert.deepEqual(results.map((r) => r.displayId), ["IDE-2", "IDE-1"]);
  assert.match(results[0].snippet, /keep one şema file/);
  assert.ok(!("description" in results[0]), "full content leaked into the result");
});

test("results stay inside the project, skip the caller's card and default statuses", () => {
  const db = makeDb();
  addCard(db, "self", { n: 1, title: "auth flow" });
  addCard(db, "other-project", { project: "p2", title: "auth flow" });
  addCard(db, "idea", { n: 3, title: "auth idea", status: "ideation" });
  addCard(db, "dropped", { n: 4, title: "auth attempt", status: "withdrawn" });

  const results = searchCards(db, { query: "auth", projectId: "p1", excludeCardId: "self" });

  assert.deepEqual(results.map((r) => r.id), ["dropped"]);
  assert.equal(results[0].status, "withdrawn");
});

test("base64 images never match a query", () => {
  const db = makeDb();
  addCard(db, "img", {
    title: "screenshot",
    description: '<p>see</p><img src="data:image/png;base64,QUJDZm9vYmFy">',
  });
  assert.deepEqual(searchCards(db, { query: "QUJD", projectId: "p1" }), []);
});

test("limit caps the rows", () => {
  const db = makeDb();
  for (let i = 0; i < 12; i++) addCard(db, `c${i}`, { title: `sync ${i}` });
  assert.equal(searchCards(db, { query: "sync", projectId: "p1" }).length, 8);
  assert.equal(searchCards(db, { query: "sync", projectId: "p1", limit: 3 }).length, 3);
});

// ---------------------------------------------------------------------------
// list_open_work
// ---------------------------------------------------------------------------

test("a plan's Files line becomes a path list, prose and parentheticals dropped", () => {
  const html =
    "<h2>Files to Modify</h2><p>the search component</p>" +
    "<p>Files: mcp-server/index.ts, lib/prompts/prior-decisions.ts (yeni, generated), " +
    "app/api/cards/[id]/evaluate/route.ts, README.md, plugin repo'sundaki plugins/ideafy/mcp/* ve üç version alanı</p>";
  assert.deepEqual(extractPlanFiles(html), [
    "mcp-server/index.ts",
    "lib/prompts/prior-decisions.ts",
    "app/api/cards/[id]/evaluate/route.ts",
    "README.md",
    "plugins/ideafy/mcp/*",
  ]);
});

test("without a Files line the Files to Modify section is read", () => {
  const html =
    "<h2>Files to Modify</h2><ul><li><p><code>lib/db/schema.ts</code> — new column</p></li></ul>" +
    "<h2>Implementation Steps</h2><p>edit other.ts too</p>";
  assert.deepEqual(extractPlanFiles(html), ["lib/db/schema.ts"]);
});

test("open work mixes git and plan sources and skips stale worktrees", async () => {
  const db = makeDb();
  addCard(db, "self", { n: 1, status: "progress", solution: "<p>Files: a.ts</p>" });
  addCard(db, "wt", { n: 2, status: "test", worktreePath: "/repo/.worktrees/x", worktreeStatus: "active", branch: "kanban/IDE-2-x" });
  addCard(db, "gone", { n: 3, status: "progress", worktreePath: "/missing", worktreeStatus: "active" });
  addCard(db, "planned", { n: 4, status: "backlog", solution: "<p>Files: lib/x.ts, lib/y.ts</p>" });
  addCard(db, "noplan", { n: 5, status: "backlog" });
  addCard(db, "done", { n: 6, status: "completed", solution: "<p>Files: lib/x.ts</p>" });

  const rows = await listOpenWork(
    db,
    { projectId: "p1", excludeCardId: "self" },
    {
      isGitRepo: async () => true,
      pathExists: (p) => p !== "/missing",
      changedFiles: async (_repo, { worktreePath }) =>
        worktreePath === "/repo/.worktrees/x" ? ["mcp-server/index.ts"] : [],
    }
  );

  const byId = Object.fromEntries(rows.map((r) => [r.displayId, r]));
  assert.deepEqual(Object.keys(byId).sort(), ["IDE-2", "IDE-4"]);
  assert.deepEqual(byId["IDE-2"], {
    id: "wt",
    displayId: "IDE-2",
    title: "wt",
    status: "test",
    branch: "kanban/IDE-2-x",
    source: "git",
    files: ["mcp-server/index.ts"],
  });
  assert.equal(byId["IDE-4"].source, "plan");
  assert.deepEqual(byId["IDE-4"].files, ["lib/x.ts", "lib/y.ts"]);
});

test("files finds overlap past the cap and puts overlapping cards first", async () => {
  const db = makeDb();
  addCard(db, "big", { n: 2, status: "test", worktreePath: "/repo/.worktrees/big", worktreeStatus: "active", branch: "kanban/IDE-2-big" });
  addCard(db, "planned", { n: 4, status: "backlog", solution: "<p>Files: plugins/ideafy/mcp/*, docs/a.md</p>" });
  addCard(db, "other", { n: 5, status: "backlog", solution: "<p>Files: lib/z.ts</p>" });
  // 52 files, like IDE-331: the shared one sorts past the 40-file cut.
  const bigFiles = [...Array.from({ length: 51 }, (_, i) => `app/f${String(i).padStart(2, "0")}.ts`), "mcp-server/index.ts"];

  const rows = await listOpenWork(
    db,
    { projectId: "p1", files: ["./mcp-server/index.ts", "plugins/ideafy/mcp/index.js", "lib/new.ts"] },
    {
      isGitRepo: async () => true,
      pathExists: () => true,
      changedFiles: async (_repo, { worktreePath }) => (worktreePath === "/repo/.worktrees/big" ? bigFiles : []),
    }
  );

  const big = rows.find((r) => r.displayId === "IDE-2")!;
  assert.equal(big.files.length, MAX_OPEN_WORK_FILES);
  assert.ok(!big.files.includes("mcp-server/index.ts"));
  assert.deepEqual(big.overlap, ["mcp-server/index.ts"]);
  assert.deepEqual(rows.find((r) => r.displayId === "IDE-4")!.overlap, ["plugins/ideafy/mcp/index.js"]);
  assert.equal(rows.find((r) => r.displayId === "IDE-5")!.overlap, undefined);
  assert.equal(rows[rows.length - 1].displayId, "IDE-5");
});

test("a project outside git only reports plan rows and never calls git", async () => {
  const db = makeDb();
  addCard(db, "w1", { project: "p2", n: 1, status: "progress", worktreeStatus: "active", worktreePath: "/x", solution: "<p>Files: notes/brief.md</p>" });

  const rows = await listOpenWork(
    db,
    { projectId: "p2" },
    {
      isGitRepo: async () => {
        throw new Error("git checked for a project with no folder");
      },
      changedFiles: async () => {
        throw new Error("git ran for a non-git project");
      },
    }
  );

  assert.deepEqual(rows.map((r) => [r.displayId, r.source, r.files]), [["WRK-1", "plan", ["notes/brief.md"]]]);
});

test("htmlToText keeps block boundaries as lines", () => {
  assert.equal(htmlToText("<p>a &amp; b</p><p>c</p>"), "a & b\nc");
});

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

test("the rule names both tools and stays silent when nothing is found", () => {
  for (const rule of [PRIOR_DECISIONS_RULE, PRIOR_DECISIONS_EVALUATION_RULE]) {
    assert.match(rule, /search_cards/);
    assert.match(rule, /list_open_work/);
    assert.match(rule, /excludeCardId/);
    assert.match(rule, /newer decision overrides/);
    // A missing tool means skip, never a detour through the database (IDE-361).
    assert.match(rule, /skip this whole check/);
    assert.match(rule, /never open the database \(`kanban\.db`, `sqlite3`\)/);
  }
  assert.match(PRIOR_DECISIONS_EVALUATION_RULE, /skipped because the tools were missing, leave `## Related Cards` out/);
  assert.match(PRIOR_DECISIONS_RULE, /write nothing about it/);
  assert.match(PRIOR_DECISIONS_EVALUATION_RULE, /leave `## Related Cards` out/);
});

test("get_card carries the rule on planning columns only", () => {
  for (const status of ["backlog", "bugs", "progress"]) {
    assert.ok(buildPriorDecisionsNote({ status })?.includes(PRIOR_DECISIONS_RULE));
  }
  for (const status of ["ideation", "test", "completed", "withdrawn"]) {
    assert.equal(buildPriorDecisionsNote({ status }), null);
  }
});

test("list_cards only selects content columns behind full", () => {
  const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  const handler = source.slice(
    source.indexOf('case "list_cards"'),
    source.indexOf('case "search_cards"')
  );
  const defaultSelect = handler.slice(handler.indexOf(': "";'), handler.indexOf("FROM cards"));
  assert.doesNotMatch(defaultSelect, /solution_summary|test_scenarios|description/);
});
