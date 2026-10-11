CREATE TABLE `climb_list_entries` (
	`list_id` text NOT NULL,
	`climb_id` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`list_id`, `climb_id`),
	FOREIGN KEY (`list_id`) REFERENCES `climb_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`climb_id`) REFERENCES `climbs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_climb_list_entries_climb_id` ON `climb_list_entries` (`climb_id`);--> statement-breakpoint
CREATE TABLE `climb_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_climb_lists_profile_id` ON `climb_lists` (`profile_id`);--> statement-breakpoint
ALTER TABLE `climbs` ADD `description` text DEFAULT '' NOT NULL;