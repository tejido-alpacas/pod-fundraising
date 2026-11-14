CREATE TABLE `refund_attempts` (
	`refund_id` text NOT NULL,
	`deposit_id` text NOT NULL,
	PRIMARY KEY(`refund_id`, `deposit_id`),
	FOREIGN KEY (`refund_id`) REFERENCES `refunds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deposit_id`) REFERENCES `deposits`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `refund_attempts_deposit_idx` ON `refund_attempts` (`deposit_id`);