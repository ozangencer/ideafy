ALTER TABLE `cards` ADD `group_order` integer;--> statement-breakpoint
CREATE TRIGGER `cards_group_order_reset` AFTER UPDATE OF `group_id` ON `cards` WHEN OLD.`group_id` IS NOT NEW.`group_id` BEGIN UPDATE `cards` SET `group_order` = NULL WHERE `id` = NEW.`id`; END;
