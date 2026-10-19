ALTER TABLE `conversations` ADD `client_timezone` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `client_timezone_source` text DEFAULT '' NOT NULL;