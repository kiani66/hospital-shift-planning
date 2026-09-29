-- Reference data: the four approved shift types (approved plan: M, E, N, ME).
-- Must match SHIFT_TYPES in src/domain/shifts/shift-type.ts (checked by an integration test).
INSERT INTO "shift_types" ("code", "label", "covers", "is_night", "sort_order") VALUES
  ('M', 'صبح', ARRAY['M'], false, 1),
  ('E', 'عصر', ARRAY['E'], false, 2),
  ('N', 'شب', ARRAY['N'], true, 3),
  ('ME', 'صبح و عصر', ARRAY['M', 'E'], false, 4)
ON CONFLICT ("code") DO NOTHING;
