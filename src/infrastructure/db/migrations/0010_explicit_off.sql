-- Add an explicit scheduling decision. Never backfill historical missing rows.
INSERT INTO "shift_types" ("code", "label", "covers", "is_night", "sort_order")
VALUES ('OFF', 'استراحت', ARRAY[]::text[], false, 5)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
-- CHANGE_SHIFT still asks for a working shift. SWAP snapshots and manual results accept OFF.
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_working_target_check"
CHECK ("target_shift_code" IS NULL OR "target_shift_code" IN ('M', 'E', 'N', 'ME'));
