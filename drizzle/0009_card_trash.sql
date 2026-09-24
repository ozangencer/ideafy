CREATE TABLE `card_trash` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`payload` text NOT NULL,
	`deleted_at` text NOT NULL
);
