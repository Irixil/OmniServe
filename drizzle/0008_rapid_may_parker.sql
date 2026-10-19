CREATE TABLE `knowledge_embeddings` (
	`knowledge_id` text PRIMARY KEY NOT NULL,
	`checksum` text NOT NULL,
	`model` text NOT NULL,
	`dimensions` integer NOT NULL,
	`embedding_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `public_knowledge` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `public_knowledge` ADD `checksum` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `public_knowledge` ADD `expires_at` text DEFAULT '' NOT NULL;