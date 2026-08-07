ALTER TABLE `ideafy_sessions` ADD `provider` text DEFAULT 'claude' NOT NULL;--> statement-breakpoint
ALTER TABLE `ideafy_sessions` ADD `cwd` text;