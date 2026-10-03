-- MCP's move_card / update_card wrote status without completed_at until IDE-406. Best guess for those cards: the last time they were touched.
UPDATE `cards` SET `completed_at` = `updated_at` WHERE `status` = 'completed' AND `completed_at` IS NULL;
