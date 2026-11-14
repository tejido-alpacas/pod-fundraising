CREATE TABLE `refund_deposits` (
	`deposit_id` text PRIMARY KEY NOT NULL,
	`refund_id` text NOT NULL,
	FOREIGN KEY (`deposit_id`) REFERENCES `deposits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`refund_id`) REFERENCES `refunds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `refund_deposits_refund_idx` ON `refund_deposits` (`refund_id`);--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`milestone_id` text NOT NULL,
	`party_id` text NOT NULL,
	`primary_wallet_hostname` text NOT NULL,
	`dq` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text NOT NULL,
	`status_reason` text,
	`started_at` text NOT NULL,
	`settled_at` text,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`,`milestone_id`) REFERENCES `milestones`(`campaign_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `refunds_milestone_idx` ON `refunds` (`campaign_id`,`milestone_id`);