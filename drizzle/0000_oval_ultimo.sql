CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`solution_summary` text DEFAULT '' NOT NULL,
	`test_scenarios` text DEFAULT '' NOT NULL,
	`ai_opinion` text DEFAULT '' NOT NULL,
	`ai_verdict` text,
	`status` text DEFAULT 'backlog' NOT NULL,
	`complexity` text DEFAULT 'medium' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`project_folder` text DEFAULT '' NOT NULL,
	`project_id` text,
	`task_number` integer,
	`git_branch_name` text,
	`git_branch_status` text,
	`git_worktree_path` text,
	`git_worktree_status` text,
	`dev_server_port` integer,
	`dev_server_pid` integer,
	`rebase_conflict` integer,
	`conflict_files` text,
	`processing_type` text,
	`ai_platform` text,
	`use_worktree` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE TABLE `chat_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`section_type` text NOT NULL,
	`cli_session_id` text NOT NULL,
	`provider` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_sessions_card_section_idx` ON `chat_sessions` (`card_id`,`section_type`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`section_type` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`mentions` text,
	`tool_calls` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ideafy_sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`state` text NOT NULL,
	`card_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`folder_path` text NOT NULL,
	`id_prefix` text NOT NULL,
	`next_task_number` integer DEFAULT 1 NOT NULL,
	`color` text DEFAULT '#5e6ad2' NOT NULL,
	`is_pinned` integer DEFAULT false NOT NULL,
	`document_paths` text,
	`narrative_path` text,
	`use_worktrees` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
