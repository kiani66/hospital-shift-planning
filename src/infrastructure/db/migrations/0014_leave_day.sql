-- D118: Leave (H) as an explicit non-working day status, distinct from OFF.
-- Additive reference data only: no column, constraint or existing row changes,
-- no backfill (OFF assignments and OFF preferences are never converted to H),
-- and immutable approved versions are untouched. A pre-existing H row (an
-- intentional edit) is kept.
INSERT INTO "shift_types" ("code", "label", "covers", "is_night", "sort_order")
VALUES ('H', 'مرخصی', ARRAY[]::text[], false, 6)
ON CONFLICT ("code") DO NOTHING;
