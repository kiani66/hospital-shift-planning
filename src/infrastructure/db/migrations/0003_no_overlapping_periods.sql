-- Date ranges that must never overlap (approved: Phase 2 review, D18 and D19).
-- Drizzle cannot model EXCLUDE constraints, so they live only in this migration;
-- docs/database.md lists them. All ranges are inclusive ('[]'); a null end date
-- is an open (unbounded) range. Adjacent ranges (one ends on D, the next starts
-- on D+1) do not overlap and stay valid.
--
-- btree_gist lets a GiST exclusion constraint combine uuid equality with the
-- daterange overlap operator. It is a trusted extension (PostgreSQL 13+), so the
-- database owner can create it on Neon and locally.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
-- D18: one department never has two schedules whose periods overlap.
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_period_no_overlap"
  EXCLUDE USING gist (
    "department_id" WITH =,
    daterange("period_start", "period_end", '[]') WITH &&
  );
--> statement-breakpoint
-- D19: a user has at most one membership of a department on any given day.
ALTER TABLE "department_memberships" ADD CONSTRAINT "department_memberships_no_overlap"
  EXCLUDE USING gist (
    "user_id" WITH =,
    "department_id" WITH =,
    daterange("started_on", "ended_on", '[]') WITH &&
  );
--> statement-breakpoint
-- D19 applies to supervisor assignments in the same way.
ALTER TABLE "supervisor_assignments" ADD CONSTRAINT "supervisor_assignments_no_overlap"
  EXCLUDE USING gist (
    "user_id" WITH =,
    "department_id" WITH =,
    daterange("started_on", "ended_on", '[]') WITH &&
  );
