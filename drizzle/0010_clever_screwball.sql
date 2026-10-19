CREATE TABLE `conversation_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`message_id` text DEFAULT '' NOT NULL,
	`file_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`analysis_json` text DEFAULT '{}' NOT NULL,
	`confidence` integer DEFAULT 0 NOT NULL,
	`provider` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`error_code` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`analyzed_at` text DEFAULT '' NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_conversation_attachments_conversation_created` ON `conversation_attachments` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_conversation_attachments_conversation_sha` ON `conversation_attachments` (`conversation_id`,`sha256`);