CREATE TABLE `party_sign_in_tokens` (
	`party_id` text PRIMARY KEY NOT NULL,
	`sealed_tokens` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action
);
