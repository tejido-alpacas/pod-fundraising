-- Written by `npm run db:generate`, then corrected by hand in two places before it was first
-- committed, because as generated it fails on a database that already holds refunds:
--   1. D1 ignores `PRAGMA foreign_keys=OFF`, so dropping `refunds` while `refund_deposits` or
--      `refund_attempts` rows point at it is refused. `defer_foreign_keys` checks those links
--      when the migration finishes instead, when the rebuilt table is in place.
--   2. The copy read `agent_wallet_hostname` from the old table, which has no such column.
--      Existing refunds all went to a primary wallet, so the new column starts empty.
PRAGMA defer_foreign_keys = ON;--> statement-breakpoint
CREATE TABLE `__new_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`milestone_id` text NOT NULL,
	`party_id` text NOT NULL,
	`primary_wallet_hostname` text,
	`agent_wallet_hostname` text,
	`dq` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text NOT NULL,
	`status_reason` text,
	`started_at` text NOT NULL,
	`settled_at` text,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`,`milestone_id`) REFERENCES `milestones`(`campaign_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "refunds_one_wallet" CHECK((primary_wallet_hostname is null) <> (agent_wallet_hostname is null))
);
--> statement-breakpoint
INSERT INTO `__new_refunds`("id", "campaign_id", "milestone_id", "party_id", "primary_wallet_hostname", "dq", "amount", "status", "status_reason", "started_at", "settled_at") SELECT "id", "campaign_id", "milestone_id", "party_id", "primary_wallet_hostname", "dq", "amount", "status", "status_reason", "started_at", "settled_at" FROM `refunds`;--> statement-breakpoint
DROP TABLE `refunds`;--> statement-breakpoint
ALTER TABLE `__new_refunds` RENAME TO `refunds`;--> statement-breakpoint
PRAGMA defer_foreign_keys = OFF;--> statement-breakpoint
CREATE INDEX `refunds_milestone_idx` ON `refunds` (`campaign_id`,`milestone_id`);