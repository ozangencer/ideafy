-- The card stores three complexity levels. The MCP's create_card wrote simple/complex and the prompts trivial/very_high; fold them onto low/high (lib/opinion-markers.ts normalizeComplexity).
-- Kept apart from 0021 on purpose: lib/db's stampExistingMigrations marks an ALTER migration applied without running it when its column already exists, which would have skipped these UPDATEs.
UPDATE `cards` SET `complexity` = 'low' WHERE `complexity` IN ('simple', 'trivial');--> statement-breakpoint
UPDATE `cards` SET `complexity` = 'high' WHERE `complexity` IN ('complex', 'very_high');
