import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

// Projects tablosu
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
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type ProjectRecord = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

// Cards tablosu
export const cards = sqliteTable("cards", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  solutionSummary: text("solution_summary").notNull().default(""),
  testScenarios: text("test_scenarios").notNull().default(""),
  aiOpinion: text("ai_opinion").notNull().default(""),
  aiVerdict: text("ai_verdict"), // "positive" | "negative" | null
  status: text("status").notNull().default("backlog"),
  complexity: text("complexity").notNull().default("medium"),
  priority: text("priority").notNull().default("medium"),
  projectFolder: text("project_folder").notNull().default(""),
  projectId: text("project_id"),
  taskNumber: integer("task_number"),
  gitBranchName: text("git_branch_name"),     // "kanban/PRJ-1-add-auth" or null
  gitBranchStatus: text("git_branch_status"), // "active" | "merged" | "rolled_back" | null
  gitWorktreePath: text("git_worktree_path"), // "/path/.worktrees/kanban/KAN-1-..." or null
  gitWorktreeStatus: text("git_worktree_status"), // "active" | "removed" | null
  devServerPort: integer("dev_server_port"),  // 3000, 3001, etc. or null
  devServerPid: integer("dev_server_pid"),    // Process ID or null
  rebaseConflict: integer("rebase_conflict", { mode: "boolean" }), // true if conflict detected during merge
  conflictFiles: text("conflict_files"),      // JSON array of conflicting file paths
  processingType: text("processing_type"),    // "autonomous" | "quick-fix" | "evaluate" | null (active Claude process indicator)
  aiPlatform: text("ai_platform"),           // "claude" | "gemini" | "codex" | null (null = use global setting)
  useWorktree: integer("use_worktree", { mode: "boolean" }), // null = follow project default, true/false = per-card override
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),  // ISO date string, null if not completed
});

export type CardRecord = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;

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
  createdAt: text("created_at").notNull(),
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

export const skillGroups = sqliteTable("skill_groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  scope: text("scope").notNull(), // "global" | "project"
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  order: integer("order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type SkillGroupRecord = typeof skillGroups.$inferSelect;
export type NewSkillGroup = typeof skillGroups.$inferInsert;

export const skillGroupItems = sqliteTable(
  "skill_group_items",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => skillGroups.id, { onDelete: "cascade" }),
    skillName: text("skill_name").notNull(),
    order: integer("order").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("skill_group_items_group_skill_idx").on(table.groupId, table.skillName),
  ]
);

export type SkillGroupItemRecord = typeof skillGroupItems.$inferSelect;
export type NewSkillGroupItem = typeof skillGroupItems.$inferInsert;
