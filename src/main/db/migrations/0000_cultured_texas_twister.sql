CREATE TABLE `achievements` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`unlocked_at` text NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE TABLE `computed_metrics` (
	`measurement_id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`wheel_circumference_m` real,
	`speed_kmh` real,
	`cadence_rpm` real,
	`distance_m` real,
	FOREIGN KEY (`measurement_id`) REFERENCES `measurements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `measurements` (
	`id` text PRIMARY KEY NOT NULL,
	`sensor_id` text NOT NULL,
	`timestamp_utc` text NOT NULL,
	`raw_data` blob NOT NULL,
	`has_wheel_data` integer NOT NULL,
	`has_crank_data` integer NOT NULL,
	`wheel_revs` integer,
	`wheel_time` integer,
	`crank_revs` integer,
	`crank_time` integer,
	`time_diff_ms` integer,
	`wheel_revs_diff` integer,
	`wheel_time_diff` integer,
	`crank_revs_diff` integer,
	`crank_time_diff` integer
);
--> statement-breakpoint
CREATE INDEX `idx_measurements_sensor_ts` ON `measurements` (`sensor_id`,`timestamp_utc`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`sensor_id` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`distance_m` real,
	`duration_s` integer,
	`avg_speed_kmh` real,
	`avg_cadence_rpm` real,
	`max_speed_kmh` real,
	`max_cadence_rpm` real
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
