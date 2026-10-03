import { z } from "zod";

import { isIsoDate, type IsoDate } from "../../domain/shared/dates";
import { normalizeEmail } from "../../infrastructure/auth/credentials";

export const managementDay = z
  .string()
  .refine(isIsoDate, "Expected YYYY-MM-DD")
  .transform((v) => v as IsoDate);
export const accountProfileInput = z.object({
  email: z.string().max(320).transform(normalizeEmail).pipe(z.email().max(320)),
  displayName: z.string().trim().min(1).max(200),
});
export const relationInput = z.object({
  userId: z.uuid(),
  departmentId: z.uuid(),
  startedOn: managementDay,
  endedOn: managementDay.nullable().default(null),
});
export const endRelationInput = z.object({
  relationId: z.uuid(),
  expectedEndedOn: managementDay.nullable(),
  endedOn: managementDay,
});
