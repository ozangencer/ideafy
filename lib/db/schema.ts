import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

// Projects tablosu
// Project sections: a sidebar-only grouping above projects ("Development",
// "Business"). Purely visual — the board, card queries, MCP and the team pool
// never read it. Collapse state lives here rather than in localStorage so the
// Electron window and a dev port show the same sidebar.
export const projectSections = sqliteTable("project_sections", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  order: integer("order").notNull().default(0),
  collapsed: integer("collapsed", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type ProjectSectionRecord = typeof projectSections.$inferSelect;
export type NewProjectSection = typeof projectSections.$inferInsert;

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  folderPath: text("folder_path").notNull(),
  idPrefix: text("id_prefix").notNull(),
  nextTaskNumber: integer("next_task_number").notNull().default(1),
  color: text("color").notNull().default("#5e6ad2"),
  isPinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
  documentPaths: text("document_paths"), // JSON array of custom document paths, null = smart discovery
  narrativePath: text("narrative_path"), // Relative path to narrative file, null = use default (docs/product-narrative.md)
  useWorktrees: integer("use_worktrees", { mode: "boolean" }).notNull().default(true), // Whether to use git worktrees for isolation
  voice: text("voice").notNull().default("builder"), // "entrepreneur" | "builder" | "engineer" — project-level voice for AI outputs
  mode: text("mode").notNull().default("development"), // "development" | "work" — which workspace lists the project, and whether dev-only actions exist
  runMode: text("run_mode"), // "server" | "app" | "xcode" | "none" — null = detect from the project folder
  runCommand: text("run_command"), // Override for the command the run button spawns, null = mode default
  previewUrl: text("preview_url"), // Override for the URL opened in server mode ({port} placeholder), null = http://localhost:{port}
  sharedPaths: text("shared_paths"), // JSON array of repo-relative paths symlinked from main checkout into the worktree, null = auto
  cmuxWorkspaceId: text("cmux_workspace_id"), // cmux workspace UUID to open this project's tabs in, "new" for a fresh workspace per run, null = match by folder
  sectionId: text("section_id").references(() => projectSections.id, { onDelete: "set null" }), // Sidebar section, null = "Other"
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type ProjectRecord = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

// Project toolkit: the skills and agents pinned to a project so the sidebar
// and the chat `/` picker surface them first. Keyed by catalog name, not by a
// provider's file path, so a pin survives switching the AI platform — a name
// the active provider cannot resolve just renders greyed out. Nothing here is
// injected into prompts or CLI arguments.
export const projectToolkitItems = sqliteTable(
  "project_toolkit_items",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // "skill" | "agent"
    name: text("name").notNull(), // Catalog name, e.g. "human-test", "ideafy:ideafy-workflow"
    source: text("source"), // "global" | "project" | null — informational only
    folder: text("folder"), // One level of grouping inside the Toolkit; null = top level
    order: integer("order").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_toolkit_items_project_kind_name_idx").on(table.projectId, table.kind, table.name),
  ]
);

export type ProjectToolkitItemRecord = typeof projectToolkitItems.$inferSelect;
export type NewProjectToolkitItem = typeof projectToolkitItems.$inferInsert;

// Card groups: a chain of cards that belong to one piece of work, so the board
// can fold 14 cards into 1 slot. Deliberately NOT called "epic" — the row has
// no status, no completion state and no target date of its own; it is a label
// with an identity. Naming it "epic" would promise Jira semantics to the user
// and, worse, to Claude over MCP.
export const cardGroups = sqliteTable("card_groups", {
  id: text("id").primaryKey(),
  projectId: text("project_id"),
  code: text("code").notNull(), // short code shown on the card face: "LOOP"
  name: text("name").notNull(), // group heading: "Loop Engineering"
  color: text("color"),
  createdAt: text("created_at").notNull(),
});

export type CardGroupRecord = typeof cardGroups.$inferSelect;
export type NewCardGroup = typeof cardGroups.$inferInsert;

// Cards tablosu
export const cards = sqliteTable("cards", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  solutionSummary: text("solution_summary").notNull().default(""),
  testScenarios: text("test_scenarios").notNull().default(""),
  aiOpinion: text("ai_opinion").notNull().default(""),
  aiVerdict: text("ai_verdict"), // "positive" | "negative" | "maybe" | null
  status: text("status").notNull().default("backlog"),
  complexity: text("complexity").notNull().default("medium"),
  priority: text("priority").notNull().default("medium"),
  projectFolder: text("project_folder").notNull().default(""),
  projectId: text("project_id"),
  groupId: text("group_id"),                  // card_groups.id or null
  groupOrder: integer("group_order"),         // manual position in the group's chain (1..N); null = by task number. Reset by trigger when group_id changes
  queuePosition: integer("queue_position"),   // place in the autonomous run queue (lowest runs next); null = not queued. Cleared by trigger when the card leaves the implementation columns
  taskNumber: integer("task_number"),
  gitBranchName: text("git_branch_name"),     // "kanban/PRJ-1-add-auth" or null
  gitBranchStatus: text("git_branch_status"), // "active" | "merged" | "rolled_back" | null
  gitWorktreePath: text("git_worktree_path"), // "/path/.worktrees/kanban/KAN-1-..." or null
  gitWorktreeStatus: text("git_worktree_status"), // "active" | "removed" | null
  devServerPort: integer("dev_server_port"),  // 3000, 3001, etc. or null
  devServerPid: integer("dev_server_pid"),    // Process ID or null
  rebaseConflict: integer("rebase_conflict", { mode: "boolean" }), // true if conflict detected during merge
  conflictFiles: text("conflict_files"),      // JSON array of conflicting file paths
  processingType: text("processing_type"),    // "autonomous" | "quick-fix" | "evaluate" | "generate" | null (active Claude process indicator)
  aiPlatform: text("ai_platform"),           // "claude" | "gemini" | "codex" | null (null = use global setting)
  useWorktree: integer("use_worktree", { mode: "boolean" }), // null = follow project default, true/false = per-card override
  outputPaths: text("output_paths"),          // JSON array of project-relative file paths the card's work produced (MCP save_output); null = none yet
  workTemplateId: text("work_template_id"),   // id from the work_templates setting that Generate runs with; null = first template
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),  // ISO date string, null if not completed
});

export type CardRecord = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;

// Card trash: a deleted card's row plus the rows that hang off it, kept as a
// JSON snapshot so the board can undo a delete. A `deleted_at` column on cards
// would have done the same with less code, but ~30 readers (and the MCP
// server, which reads SQLite directly) would each need a filter — and the one
// that forgets it resurrects a deleted card. Entries older than a week are
// pruned on the next delete.
export const cardTrash = sqliteTable("card_trash", {
  id: text("id").primaryKey(),
  cardId: text("card_id").notNull(),
  payload: text("payload").notNull(), // JSON: { card, conversations, chatSessions, activityEvents }
  deletedAt: text("deleted_at").notNull(),
});

export type CardTrashRecord = typeof cardTrash.$inferSelect;
export type NewCardTrash = typeof cardTrash.$inferInsert;

// Settings tablosu - key-value store
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type SettingRecord = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;

// Conversations tablosu - AI chat history per card section
export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  cardId: text("card_id").notNull().references(() => cards.id, { onDelete: "cascade" }),
  sectionType: text("section_type").notNull(), // "detail" | "opinion" | "solution" | "tests"
  role: text("role").notNull(), // "user" | "assistant"
  content: text("content").notNull(),
  mentions: text("mentions"), // JSON array of mention data
  toolCalls: text("tool_calls"), // JSON array of tool call data
  createdAt: text("created_at").notNull(),
});

export type ConversationRecord = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;

// Ideafy sessions — maps a Claude Code session to a card binding, enabling
// card-aware hooks in terminal sessions not launched from Ideafy's UI.
// state: "offered" = hook has shown the card-creation offer once and is now
//        silent until the user explicitly binds a card.
//        "bound"   = session is attached to a card; hook returns the
//        phase-aware policy for that card.
export const ideafySessions = sqliteTable("ideafy_sessions", {
  sessionId: text("session_id").primaryKey(),
  projectId: text("project_id"),
  state: text("state").notNull(), // "offered" | "bound"
  cardId: text("card_id"),
  // Which CLI the session belongs to. Only Claude Code registers sessions
  // here today (the UserPromptSubmit hook is Claude-specific), so existing
  // rows are correct under the default.
  provider: text("provider").notNull().default("claude"),
  // The directory the CLI was launched from. Resume is cwd-scoped — the
  // provider looks for the transcript in a folder derived from it — so a
  // session started inside a worktree can only be resumed from that same
  // path. Null on rows written before this column existed.
  cwd: text("cwd"),
  // Set only on rows recorded from a one-shot run (Evaluate, Start, Quick
  // Fix): what the run was — "evaluate", "planning", "implementation",
  // "retest", "verify" or "quick-fix". Null for sessions bound from a
  // terminal, and for runs recorded before this column existed.
  runKind: text("run_kind"),
  createdAt: text("created_at").notNull(),
  // Refreshed on every bound turn by the hook, so it doubles as "last used"
  // and gives the session list a meaningful sort order.
  updatedAt: text("updated_at").notNull(),
});

export type IdeafySessionRecord = typeof ideafySessions.$inferSelect;
export type NewIdeafySession = typeof ideafySessions.$inferInsert;

// Chat sessions — maps (cardId, sectionType) to CLI session ID for resume
export const chatSessions = sqliteTable("chat_sessions", {
  id: text("id").primaryKey(),
  cardId: text("card_id").notNull().references(() => cards.id, { onDelete: "cascade" }),
  sectionType: text("section_type").notNull(),
  cliSessionId: text("cli_session_id").notNull(),
  provider: text("provider").notNull(), // "claude" | "codex" | "gemini"
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at").notNull(),
}, (table) => [
  uniqueIndex("chat_sessions_card_section_provider_idx").on(table.cardId, table.sectionType, table.provider),
]);

export type ChatSessionRecord = typeof chatSessions.$inferSelect;
export type NewChatSession = typeof chatSessions.$inferInsert;

// Activity events: persistent feed of completed AI work (opinion/plan/
// implementation/autonomous/sync …). Toasts are ephemeral; this table backs the
// notification bell so events survive refresh and the user can scan history.
//
// Dedup: (cardId, type) is unique so re-running the same flow on the same card
// upserts a single row instead of flooding the inbox. SQLite treats multiple
// NULL cardIds as distinct, so app-wide events (sync) keep their own rows.
// Previous run snapshots are pushed into payload.history (FIFO, max 10).
export const activityEvents = sqliteTable(
  "activity_events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(), // 'opinion' | 'plan' | 'implementation' | 'autonomous' | 'sync' | …
    cardId: text("card_id"),
    projectId: text("project_id"),
    title: text("title").notNull(),
    summary: text("summary"),
    payload: text("payload"),
    isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("activity_events_card_type_idx").on(table.cardId, table.type),
  ]
);

export type ActivityEventRecord = typeof activityEvents.$inferSelect;
export type NewActivityEvent = typeof activityEvents.$inferInsert;
