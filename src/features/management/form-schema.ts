import { z } from "zod";

import { isIsoDate, type IsoDate } from "@/domain/shared/dates";
import { parseJalaliInput } from "@/features/calendar/jalali-input";

const id = z.uuid("اطلاعات فرم معتبر نیست. صفحه را تازه کنید.");
const department = z.uuid("یک بخش فعال انتخاب کنید.");
const profile = z.object({
  displayName: z
    .string("نام را وارد کنید.")
    .trim()
    .min(1, "نام را وارد کنید.")
    .max(200, "نام باید حداکثر ۲۰۰ نویسه باشد."),
  email: z
    .string("ایمیل را وارد کنید.")
    .trim()
    .toLowerCase()
    .max(320, "ایمیل بیش از حد طولانی است.")
    .pipe(z.email("ایمیل معتبر وارد کنید.")),
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

export const managementFormSchemas = {
  create: profile.extend({
    password: z
      .string("رمز اولیه را وارد کنید.")
      .min(12, "رمز اولیه باید حداقل ۱۲ نویسه باشد.")
      .max(256, "رمز اولیه باید حداکثر ۲۵۶ نویسه باشد."),
  }),
  profile: profile.extend({
    userId: id,
    expectedEmail: z.string(),
    expectedDisplayName: z.string(),
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
