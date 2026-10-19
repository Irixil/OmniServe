ALTER TABLE `conversations` ADD `priority` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `next_action` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `reply_drafts` ADD `cases_json` text DEFAULT '[]' NOT NULL;