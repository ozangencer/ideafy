CREATE TABLE `card_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `cards` ADD `group_id` text;