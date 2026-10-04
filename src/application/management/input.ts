import { z } from "zod";

import { parseOptionalMobileNumber } from "../../domain/identity/mobile";
import { normalizeDisplayName } from "../../domain/identity/normalize";
import { isIsoDate, type IsoDate } from "../../domain/shared/dates";
import { normalizeEmail } from "../../infrastructure/auth/credentials";

export const managementDay = z
  .string()
  .refine(isIsoDate, "Expected YYYY-MM-DD")
  .transform((v) => v as IsoDate);

/** A required e-mail address, normalized like sign-in. */
export const emailInput = z
  .string()
  .max(320)
  .transform(normalizeEmail)
  .pipe(z.email().max(320));

/** Optional e-mail: blank, null or missing means none. */
export const optionalEmailInput = z
  .string()
  .max(320)
  .nullish()
  .transform((v) => (v == null || v.trim() === "" ? null : normalizeEmail(v)))
  .pipe(z.email().max(320).nullable());

/** Optional Iranian mobile, normalized to 09xxxxxxxxx; blank means none. */
export const optionalMobileInput = z
  .string()
  .max(40)
  .nullish()
  .transform((value, ctx) => {
    const parsed = parseOptionalMobileNumber(value);
    if (parsed.ok) return parsed.value;
    ctx.addIssue({ code: "custom", message: parsed.error.message });
    return z.NEVER;
  });

export const displayNameInput = z
  .string()
  .max(400)
  .transform(normalizeDisplayName)
  .pipe(z.string().min(1).max(200));

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
