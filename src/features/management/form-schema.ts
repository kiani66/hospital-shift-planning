import { z } from "zod";

import { parseOptionalMobileNumber } from "@/domain/identity/mobile";
import { parsePersonnelNumber } from "@/domain/identity/personnel-number";
import { isIsoDate, type IsoDate } from "@/domain/shared/dates";
import { parseJalaliInput } from "@/features/calendar/jalali-input";

const id = z.uuid("اطلاعات فرم معتبر نیست. صفحه را تازه کنید.");
const department = z.uuid("یک بخش فعال انتخاب کنید.");
const displayName = z
  .string("نام را وارد کنید.")
  .trim()
  .min(1, "نام را وارد کنید.")
  .max(200, "نام باید حداکثر ۲۰۰ نویسه باشد.");
/** Blank means no e-mail; the command normalizes again. */
const optionalEmail = z
  .string()
  .default("")
  .pipe(
    z
      .string()
      .trim()
      .toLowerCase()
      .max(320, "ایمیل بیش از حد طولانی است.")
      .pipe(z.union([z.literal(""), z.email("ایمیل معتبر وارد کنید.")])),
  )
  .transform((v) => (v === "" ? null : v));
const optionalMobile = z
  .string()
  .default("")
  .pipe(z.string().max(40, "شماره موبایل معتبر وارد کنید."))
  .transform((value, ctx) => {
    const parsed = parseOptionalMobileNumber(value);
    if (parsed.ok) return parsed.value;
    ctx.addIssue({
      code: "custom",
      message: "شماره موبایل معتبر ایران وارد کنید (مثلاً ۰۹۱۲۱۲۳۴۵۶۷).",
    });
    return z.NEVER;
  });
export const personnelNumberField = z
  .string("شماره پرسنلی را وارد کنید.")
  .max(200, "شماره پرسنلی باید فقط شامل ۱ تا ۲۰ رقم باشد.")
  .transform((value, ctx) => {
    const parsed = parsePersonnelNumber(value);
    if (parsed.ok) return parsed.value as string;
    ctx.addIssue({
      code: "custom",
      message:
        parsed.error.reason === "PERSONNEL_NUMBER_REQUIRED"
          ? "شماره پرسنلی را وارد کنید."
          : "شماره پرسنلی باید فقط شامل ۱ تا ۲۰ رقم باشد.",
    });
    return z.NEVER;
  });
const day = z
  .string("تاریخ شمسی را وارد کنید.")
  .trim()
  .max(10, "تاریخ شمسی معتبر وارد کنید.")
  .transform((value, ctx) => {
    const parsed = parseJalaliInput(value);
    if (!parsed) {
      ctx.addIssue({
        code: "custom",
        message: "تاریخ شمسی معتبر با قالب سال/ماه/روز وارد کنید.",
      });
      return z.NEVER;
    }
    return parsed;
  });
const optionalDay = z
  .string()
  .trim()
  .pipe(z.union([z.literal("").transform(() => null), day]));
const expectedEnd = z.union([
  z.literal("").transform(() => null),
  z
    .string()
    .refine(isIsoDate, "اطلاعات تاریخ فرم معتبر نیست. صفحه را تازه کنید.")
    .transform((v) => v as IsoDate),
]);
const role = z.enum(["NURSE", "HEAD_NURSE"], "نقش عضویت را انتخاب کنید.");
const active = z
  .enum(["true", "false"], "وضعیت فرم معتبر نیست.")
  .transform((v) => v === "true");
const transition = z.object({
  relationId: id,
  expectedEndedOn: expectedEnd,
  departmentId: department,
  role,
  startedOn: day,
  endedOn: optionalDay,
});

const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");

export const managementFormSchemas = {
  create: z.object({
    personnelNumber: personnelNumberField,
    displayName,
    email: optionalEmail,
    mobile: optionalMobile,
    issueTemporaryPassword: checkbox,
  }),
  profile: z.object({
    userId: id,
    displayName,
    email: optionalEmail,
    mobile: optionalMobile,
    expectedEmail: z.string(),
    expectedDisplayName: z.string(),
    expectedMobile: z.string().default(""),
  }),
  personnelNumber: z.object({
    userId: id,
    personnelNumber: personnelNumberField,
    expectedPersonnelNumber: z
      .string()
      .default("")
      .transform((v) => (v === "" ? null : v)),
  }),
  temporaryPassword: z.object({
    userId: id,
    expectedHasCredentials: active,
  }),
  status: z.object({ userId: id, isActive: active, expectedIsActive: active }),
  add: z.object({
    userId: id,
    departmentId: department,
    role,
    startedOn: day,
    endedOn: optionalDay,
  }),
  end: z.object({ relationId: id, expectedEndedOn: expectedEnd, endedOn: day }),
  transfer: transition,
  role: transition,
  authority: z.object({
    userId: id,
    isHospitalAdmin: active,
    expectedIsHospitalAdmin: active,
    expectedIsActive: active,
  }),
  supervisorAdd: z.object({
    userId: id,
    departmentId: department,
    startedOn: day,
    endedOn: optionalDay,
  }),
  supervisorEnd: z.object({
    relationId: id,
    expectedEndedOn: expectedEnd,
    endedOn: day,
  }),
} as const;

export type ManagementOperation = keyof typeof managementFormSchemas;

/** Read only the chosen operation's fields. Unexpected authority/security inputs are discarded. */
export function parseManagementForm(
  operation: ManagementOperation,
  form: FormData,
) {
  const schema = managementFormSchemas[operation];
  const values = Object.fromEntries(
    Object.keys(schema.shape).map((key) => {
      const value = form.get(key);
      return [key, typeof value === "string" ? value : undefined];
    }),
  );
  return schema.safeParse(values);
}
