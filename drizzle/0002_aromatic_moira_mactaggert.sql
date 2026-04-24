DROP INDEX `chat_sessions_card_section_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `chat_sessions_card_section_provider_idx` ON `chat_sessions` (`card_id`,`section_type`,`provider`);