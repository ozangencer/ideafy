import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

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
  teamId: text("team_id"), // UUID from Supabase teams table, nullable
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
  poolCardId: text("pool_card_id"),          // UUID from Supabase pool_cards table, null if not synced
  assignedTo: text("assigned_to"),           // User ID from Supabase, null if unassigned
  assignedToName: text("assigned_to_name"),  // Display name cache, null if unassigned
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
