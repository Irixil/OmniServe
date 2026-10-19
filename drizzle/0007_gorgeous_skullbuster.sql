CREATE TABLE `conversation_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`author_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_conversation_notes_conversation_created` ON `conversation_notes` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `model_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text DEFAULT '' NOT NULL,
	`operation` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`estimated_cost_micros` integer DEFAULT 0 NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`error_code` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_model_runs_conversation_created` ON `model_runs` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `reply_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`analysis_id` text NOT NULL,
	`previous_draft_id` text DEFAULT '' NOT NULL,
	`version` integer NOT NULL,
	`english_content` text NOT NULL,
	`chinese_meaning` text NOT NULL,
	`meaning_changes_json` text DEFAULT '[]' NOT NULL,
	`risks_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` text NOT NULL,
	`confirmed_by` text DEFAULT '' NOT NULL,
	`confirmed_at` text DEFAULT '' NOT NULL,
	`sent_message_id` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_reply_drafts_conversation_version` ON `reply_drafts` (`conversation_id`,`version`);--> statement-breakpoint
CREATE TABLE `semantic_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`source_message_id` text NOT NULL,
	`source_message_count` integer NOT NULL,
	`purpose` text NOT NULL,
	`status` text DEFAULT 'valid' NOT NULL,
	`snapshot_json` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`created_by` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_semantic_analyses_conversation_created` ON `semantic_analyses` (`conversation_id`,`created_at`);