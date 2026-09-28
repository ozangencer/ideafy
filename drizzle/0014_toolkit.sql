CREATE TABLE `project_toolkit_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`source` text,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_toolkit_items_project_kind_name_idx` ON `project_toolkit_items` (`project_id`,`kind`,`name`);--> statement-breakpoint
DROP TABLE `skill_group_items`;--> statement-breakpoint
DROP TABLE `skill_groups`;