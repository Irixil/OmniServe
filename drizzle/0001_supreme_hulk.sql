CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_code` text NOT NULL,
	`name` text NOT NULL,
	`client_name` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`building_type` text DEFAULT '' NOT NULL,
	`status` text DEFAULT '接洽中' NOT NULL,
	`contact_name` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_projects_owner_updated` ON `projects` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_projects_owner_status` ON `projects` (`owner_id`,`status`);--> statement-breakpoint
ALTER TABLE `assets` ADD `project_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `asset_kind` text DEFAULT '效果图' NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `phase` text DEFAULT '方案' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_assets_owner_project` ON `assets` (`owner_id`,`project_id`);--> statement-breakpoint
ALTER TABLE `requirements` ADD `project_id` text DEFAULT '' NOT NULL;