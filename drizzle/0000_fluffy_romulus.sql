CREATE TABLE `qloo_usage` (
	`bucket` text PRIMARY KEY NOT NULL,
	`window` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL
);
