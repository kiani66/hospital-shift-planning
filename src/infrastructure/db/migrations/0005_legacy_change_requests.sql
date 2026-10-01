-- Phase 9: keep the Phase 2 change-request tables as legacy history storage.
--
-- Non-destructive: the tables, their rows, keys, foreign keys, checks and
-- indexes are renamed, never dropped or rewritten. No application code reads
-- or writes them after Phase 9, and their rows are not Phase 9 requests (no
-- lossless mapping exists: multi-day items, free-text reason, no type).
-- Dropping them is a future, explicit decision (docs/database.md).
--
-- Renaming frees the names for the Phase 9 schema (migration 0006). The
-- previous deployment never touches these tables at runtime, so the rename is
-- safe while it keeps running during a deploy.

ALTER TYPE "change_request_status" RENAME TO "legacy_change_request_status";--> statement-breakpoint

ALTER TABLE "shift_change_requests" RENAME TO "legacy_shift_change_requests";--> statement-breakpoint
ALTER TABLE "legacy_shift_change_requests" RENAME CONSTRAINT "shift_change_requests_pkey" TO "legacy_shift_change_requests_pkey";--> statement-breakpoint
ALTER TABLE "legacy_shift_change_requests" RENAME CONSTRAINT "shift_change_requests_schedule_id_schedules_id_fk" TO "legacy_shift_change_requests_schedule_fk";--> statement-breakpoint
ALTER TABLE "legacy_shift_change_requests" RENAME CONSTRAINT "shift_change_requests_requester_id_users_id_fk" TO "legacy_shift_change_requests_requester_fk";--> statement-breakpoint
ALTER TABLE "legacy_shift_change_requests" RENAME CONSTRAINT "shift_change_requests_counterpart_user_id_users_id_fk" TO "legacy_shift_change_requests_counterpart_fk";--> statement-breakpoint
ALTER TABLE "legacy_shift_change_requests" RENAME CONSTRAINT "shift_change_requests_reviewed_by_users_id_fk" TO "legacy_shift_change_requests_reviewed_by_fk";--> statement-breakpoint
-- PostgreSQL truncated this generated name to 63 characters.
ALTER TABLE "legacy_shift_change_requests" RENAME CONSTRAINT "shift_change_requests_resolved_revision_id_schedule_revisions_i" TO "legacy_shift_change_requests_resolved_revision_fk";--> statement-breakpoint
ALTER TABLE "legacy_shift_change_requests" RENAME CONSTRAINT "shift_change_requests_roster_fk" TO "legacy_shift_change_requests_roster_fk";--> statement-breakpoint
ALTER TABLE "legacy_shift_change_requests" RENAME CONSTRAINT "shift_change_requests_counterpart_check" TO "legacy_shift_change_requests_counterpart_check";--> statement-breakpoint
ALTER TABLE "legacy_shift_change_requests" RENAME CONSTRAINT "shift_change_requests_reviewed_check" TO "legacy_shift_change_requests_reviewed_check";--> statement-breakpoint
ALTER INDEX "shift_change_requests_schedule_idx" RENAME TO "legacy_shift_change_requests_schedule_idx";--> statement-breakpoint
ALTER INDEX "shift_change_requests_requester_idx" RENAME TO "legacy_shift_change_requests_requester_idx";--> statement-breakpoint

ALTER TABLE "shift_change_request_items" RENAME TO "legacy_shift_change_request_items";--> statement-breakpoint
ALTER TABLE "legacy_shift_change_request_items" RENAME CONSTRAINT "shift_change_request_items_request_id_date_pk" TO "legacy_shift_change_request_items_pk";--> statement-breakpoint
-- PostgreSQL truncated these generated names to 63 characters.
ALTER TABLE "legacy_shift_change_request_items" RENAME CONSTRAINT "shift_change_request_items_request_id_shift_change_requests_id_" TO "legacy_shift_change_request_items_request_fk";--> statement-breakpoint
ALTER TABLE "legacy_shift_change_request_items" RENAME CONSTRAINT "shift_change_request_items_current_shift_code_shift_types_code_" TO "legacy_shift_change_request_items_current_shift_fk";--> statement-breakpoint
ALTER TABLE "legacy_shift_change_request_items" RENAME CONSTRAINT "shift_change_request_items_desired_shift_code_shift_types_code_" TO "legacy_shift_change_request_items_desired_shift_fk";
