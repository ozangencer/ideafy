CREATE TABLE `activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`card_id` text,
	`project_id` text,
	`title` text NOT NULL,
	`summary` text,
	`payload` text,
	`is_read` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_events_card_type_idx` ON `activity_events` (`card_id`,`type`);