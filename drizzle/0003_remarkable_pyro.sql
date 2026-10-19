CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text DEFAULT '' NOT NULL,
	`event_type` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_entity_created` ON `audit_events` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`sender` text NOT NULL,
	`content` text NOT NULL,
	`citations_json` text DEFAULT '[]' NOT NULL,
	`cases_json` text DEFAULT '[]' NOT NULL,
	`mode` text DEFAULT 'grounded' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_chat_messages_conversation_created` ON `chat_messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`access_token_hash` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`status` text DEFAULT 'ai' NOT NULL,
	`assigned_to` text DEFAULT '' NOT NULL,
	`inquiry_json` text DEFAULT '{}' NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_conversations_updated` ON `conversations` (`updated_at`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`contact_name` text NOT NULL,
	`organization` text DEFAULT '' NOT NULL,
	`email` text NOT NULL,
	`country` text DEFAULT '' NOT NULL,
	`timezone` text DEFAULT '' NOT NULL,
	`consent_at` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`summary_en` text NOT NULL,
	`summary_zh` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_leads_conversation` ON `leads` (`conversation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_leads_idempotency` ON `leads` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_leads_status_updated` ON `leads` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `public_knowledge` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`title_en` text NOT NULL,
	`title_zh` text NOT NULL,
	`content_en` text NOT NULL,
	`content_zh` text NOT NULL,
	`keywords_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `assets` ADD `visibility` text DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `rights_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `public_title_en` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `public_title_zh` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `public_description_en` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `public_description_zh` text DEFAULT '' NOT NULL;