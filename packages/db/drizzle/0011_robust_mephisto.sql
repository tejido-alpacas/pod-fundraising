CREATE TABLE `donations` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`amount` integer NOT NULL,
	`payment_digest` text,
	`received_at` text NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `donations_payment_digest_unique` ON `donations` (`payment_digest`);--> statement-breakpoint
CREATE INDEX `donations_campaign_idx` ON `donations` (`campaign_id`);