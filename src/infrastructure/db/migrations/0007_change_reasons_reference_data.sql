-- Reference data: change reasons (Phase 9). Codes are stable and reportable;
-- labels are display text. Never delete a reason once it may be referenced:
-- retire it with is_active = false in a later migration. OTHER always needs
-- an explanatory note (also a check constraint).
INSERT INTO "change_reasons" ("code", "label", "scope", "requires_note", "is_active", "sort_order") VALUES
  ('ILLNESS', 'بیماری', 'BOTH', false, true, 1),
  ('FAMILY_EMERGENCY', 'فوریت خانوادگی', 'REQUEST', false, true, 2),
  ('PERSONAL_MATTER', 'کار شخصی', 'REQUEST', false, true, 3),
  ('EDUCATION', 'آموزش یا دوره', 'BOTH', false, true, 4),
  ('STAFFING_NEED', 'نیاز عملیاتی بخش', 'ADJUSTMENT', false, true, 5),
  ('WORKLOAD_BALANCE', 'تعادل بار کاری', 'ADJUSTMENT', false, true, 6),
  ('OTHER', 'سایر', 'BOTH', true, true, 99)
ON CONFLICT ("code") DO NOTHING;
