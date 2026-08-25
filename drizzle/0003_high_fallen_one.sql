CREATE TABLE `climb_sends` (
	`climb_kind` text NOT NULL,
	`climb_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`rating` integer NOT NULL,
	`sent_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`climb_kind`, `climb_id`, `profile_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "climb_sends_kind_check" CHECK("climb_sends"."climb_kind" IN ('demo', 'saved')),
	CONSTRAINT "climb_sends_rating_check" CHECK("climb_sends"."rating" IN (1, 2, 3, 4, 5))
);
--> statement-breakpoint
CREATE INDEX `idx_climb_sends_profile_id` ON `climb_sends` (`profile_id`);
