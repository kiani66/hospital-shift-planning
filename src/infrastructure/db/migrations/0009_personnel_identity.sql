-- Personnel identity, stage 1 of 2 (expand). Additive and backward compatible:
-- * personnel_number: nullable for now; format (1-20 ASCII digits, text so leading
--   zeros survive) and uniqueness are enforced immediately. Legacy rows keep NULL
--   until a genuine number is supplied through the audited correction workflow.
--   No number is invented or derived from e-mail here.
-- * email becomes optional; every row must still have at least one login identifier.
-- * mobile: optional, canonical 09xxxxxxxxx, not unique.
-- * must_change_password / session_version / password_changed_at support temporary
--   passwords and server-side session invalidation. Existing rows: false / 0 / NULL.
-- Stage 2 (personnel_number SET NOT NULL) is NOT part of this migration; see
-- src/infrastructure/db/staged/0010_personnel_number_required.sql and docs/database.md.
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "personnel_number" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mobile" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "users_personnel_number_key" ON "users" USING btree ("personnel_number");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_personnel_number_format_check" CHECK ("users"."personnel_number" ~ '^[0-9]{1,20}$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_mobile_format_check" CHECK ("users"."mobile" ~ '^09[0-9]{9}$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_login_identifier_check" CHECK ("users"."email" is not null or "users"."personnel_number" is not null);