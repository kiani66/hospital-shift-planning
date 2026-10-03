import { addDays, type IsoDate } from "@/domain/shared/dates";

import { faDigits, isJalaliMonth, jalaliMonthPeriod, toJalali } from "./jalali";

/** A typed calendar day in the presentation adapter; ICU determines month length/leap years. */
export function parseJalaliInput(value: unknown): IsoDate | null {
  if (typeof value !== "string") return null;
  const latin = value
    .trim()
    .replace(/[۰-۹٠-٩]/g, (digit) =>
      String(digit.charCodeAt(0) - (digit >= "۰" ? 0x06f0 : 0x0660)),
    );
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(latin);
  if (!match) return null;
  const month = { year: Number(match[1]), month: Number(match[2]) };
  const day = Number(match[3]);
  if (!isJalaliMonth(month) || day < 1 || day > 31) return null;
  const period = jalaliMonthPeriod(month);
  const candidate = addDays(period.start, day - 1);
  return candidate <= period.end ? candidate : null;
}

export function formatJalaliInput(date: IsoDate): string {
  const j = toJalali(date);
  return `${faDigits(j.year)}/${faDigits(j.month).padStart(2, "۰")}/${faDigits(j.day).padStart(2, "۰")}`;
}
