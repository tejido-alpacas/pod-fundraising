CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`beneficiary` text NOT NULL,
	`creator_name` text NOT NULL,
	`creator_email` text NOT NULL,
	`status` text NOT NULL,
	`cadence` text NOT NULL,
	`log_work_commodity_hash` text,
	`milestone_hit_commodity_hash` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `deposits` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`amount` integer NOT NULL,
	`refunded_at` text,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deposits_entry_id_unique` ON `deposits` (`entry_id`);--> statement-breakpoint
CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`milestone_id` text NOT NULL,
	`party_id` text NOT NULL,
	`item` text NOT NULL,
	`inputs` text NOT NULL,
	`status` text NOT NULL,
	`status_reason` text,
	`paying_wallet` text,
	`twist_id` text,
	`filed_at` text NOT NULL,
	`stamped_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`,`milestone_id`) REFERENCES `milestones`(`campaign_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entries_twist_id_unique` ON `entries` (`twist_id`);--> statement-breakpoint
CREATE INDEX `entries_campaign_filed_idx` ON `entries` (`campaign_id`,`filed_at`);--> statement-breakpoint
CREATE INDEX `entries_party_idx` ON `entries` (`party_id`);--> statement-breakpoint
CREATE TABLE `milestones` (
	`campaign_id` text NOT NULL,
	`id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`kind` text NOT NULL,
	`owner_party_id` text NOT NULL,
	`confirmer_party_id` text NOT NULL,
	`due_date` text NOT NULL,
	`state` text NOT NULL,
	`confirmed_at` text,
	PRIMARY KEY(`campaign_id`, `id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmer_party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `parties` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`role` text NOT NULL,
	`name` text NOT NULL,
	`title` text NOT NULL,
	`email` text NOT NULL,
	`reporter_code` text NOT NULL,
	`agent_wallet_hostname` text,
	`primary_wallet_hostname` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `parties_reporter_code_unique` ON `parties` (`reporter_code`);--> statement-breakpoint
CREATE INDEX `parties_campaign_idx` ON `parties` (`campaign_id`);