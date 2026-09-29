CREATE TABLE "login_throttles" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"failed_count" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone
);
