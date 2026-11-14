CREATE TABLE `campaign_funding` (
	`campaign_id` text PRIMARY KEY NOT NULL,
	`raised` integer NOT NULL,
	`donations` integer NOT NULL,
	`read_at` text NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `campaigns` ADD `funding_goal` integer;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `donation_commodity_id` integer;