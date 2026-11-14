CREATE TABLE `item_provisioning` (
	`campaign_id` text NOT NULL,
	`item` text NOT NULL,
	`twin_id` integer,
	`twin_hostname` text,
	`commodity_hash` text,
	`commodity_id` integer,
	`catalog_item_id` integer,
	`locked_until` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`campaign_id`, `item`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
