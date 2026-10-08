-- shift_types.label is the source of the descriptive shift names on screen.
-- Align ME with the name the UI has always shown («طولانی»); the code stays ME.
-- Only the original 0002 value is replaced, so a later intentional edit is kept.
UPDATE "shift_types" SET "label" = 'طولانی' WHERE "code" = 'ME' AND "label" = 'صبح و عصر';
