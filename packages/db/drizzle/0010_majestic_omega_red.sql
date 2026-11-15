CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`party_id` text NOT NULL,
	`what` text NOT NULL,
	`subject` text NOT NULL,
	`kind` text NOT NULL,
	`due_date` text NOT NULL,
	`raised_at` text NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminders_once_idx` ON `reminders` (`campaign_id`,`party_id`,`what`,`subject`,`kind`);--> statement-breakpoint
CREATE INDEX `reminders_party_idx` ON `reminders` (`party_id`);--> statement-breakpoint
CREATE TABLE `work_log_schedules` (
	`campaign_id` text PRIMARY KEY NOT NULL,
	`started_on` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
