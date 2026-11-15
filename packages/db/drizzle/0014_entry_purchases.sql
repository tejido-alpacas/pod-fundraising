CREATE TABLE `entry_purchases` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`catalog_item_id` integer,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entry_purchases_transaction_idx` ON `entry_purchases` (`transaction_id`);