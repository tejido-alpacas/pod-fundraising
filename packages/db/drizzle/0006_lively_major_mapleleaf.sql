CREATE TABLE `evidence_files` (
	`sha256` text PRIMARY KEY NOT NULL,
	`uploaded_by_party_id` text NOT NULL,
	`visibility` text NOT NULL,
	`not_public_kind` text,
	`not_public_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`uploaded_by_party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action
);
