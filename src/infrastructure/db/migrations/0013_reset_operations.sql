CREATE TABLE "reset_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"executing_admin_id" uuid NOT NULL,
	"scope" jsonb NOT NULL,
	"selected_categories" jsonb NOT NULL,
	"automatic_categories" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" text NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	CONSTRAINT "reset_operations_result_check" CHECK ("reset_operations"."result" in ('COMPLETED','FAILED'))
);
