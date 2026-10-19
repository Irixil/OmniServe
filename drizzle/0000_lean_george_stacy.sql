CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`file_key` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`building_type` text NOT NULL,
	`viewpoint` text NOT NULL,
	`shot_scale` text NOT NULL,
	`atmosphere` text NOT NULL,
	`style` text DEFAULT '' NOT NULL,
	`environment` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_assets_owner_created` ON `assets` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_assets_owner_building` ON `assets` (`owner_id`,`building_type`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_documents_owner_created` ON `documents` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`original_text` text NOT NULL,
	`parsed_json` text NOT NULL,
	`selected_asset_ids` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_requirements_owner_created` ON `requirements` (`owner_id`,`created_at`);