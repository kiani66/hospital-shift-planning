-- Personnel identity, stage 2 of 2 (contract): personnel_number becomes NOT NULL.
--
-- STAGED, NOT JOURNALED. This file is deliberately outside
-- src/infrastructure/db/migrations, so `db:migrate` and `vercel-build` never apply
-- it. Promote it only after `pnpm db:personnel-inventory` reports zero missing
-- personnel numbers on the target database AND the product owner has explicitly
-- authorized the strict stage for Production (docs/database.md, "Personnel number
-- stages"). tests/integration/personnel-number-stages.test.ts exercises it.
--
-- Fails safely: if any user still lacks a personnel number, the guard raises and
-- the surrounding migration transaction rolls back without changing anything.
DO $$
DECLARE
  missing integer;
BEGIN
  SELECT count(*) INTO missing FROM "users" WHERE "personnel_number" IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'personnel_number backfill incomplete: % user(s) have no personnel number', missing
      USING HINT = 'Run pnpm db:personnel-inventory and backfill through the audited workflow first.';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "personnel_number" SET NOT NULL;
