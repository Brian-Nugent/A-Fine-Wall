CREATE TABLE `climbs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`grade` text NOT NULL,
	`setter` text NOT NULL,
	`created_at` integer NOT NULL,
	`holds_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_climbs_created_at` ON `climbs` (`created_at`);--> statement-breakpoint
CREATE TABLE `wall_configuration` (
	`id` integer PRIMARY KEY NOT NULL,
	`holds_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
