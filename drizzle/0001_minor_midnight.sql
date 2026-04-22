CREATE TABLE `skill_group_items` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`skill_name` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `skill_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_group_items_group_skill_idx` ON `skill_group_items` (`group_id`,`skill_name`);--> statement-breakpoint
CREATE TABLE `skill_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`scope` text NOT NULL,
	`project_id` text,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
