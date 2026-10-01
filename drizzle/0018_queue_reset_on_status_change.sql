DROP TRIGGER IF EXISTS `cards_queue_position_reset`;--> statement-breakpoint
CREATE TRIGGER `cards_queue_position_reset` AFTER UPDATE OF `status` ON `cards` WHEN NEW.`queue_position` IS NOT NULL AND OLD.`status` <> NEW.`status` AND NEW.`status` IN ('test', 'completed', 'withdrawn', 'ideation') BEGIN UPDATE `cards` SET `queue_position` = NULL WHERE `id` = NEW.`id`; END;
