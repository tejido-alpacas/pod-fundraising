CREATE TABLE `donation_undos` (
	`donation_id` text PRIMARY KEY NOT NULL,
	`twist_id` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text NOT NULL,
	`status_reason` text,
	`started_at` text NOT NULL,
	`settled_at` text,
	FOREIGN KEY (`donation_id`) REFERENCES `donations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `donation_undos_twist_id_unique` ON `donation_undos` (`twist_id`);