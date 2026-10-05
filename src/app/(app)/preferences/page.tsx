import type { Metadata } from "next";

import {
  getMyPreferencesPage,
  type PreferenceMonthCalendar,
} from "@/application/preferences/queries";
import { requireRequestContext } from "@/features/auth/guards";
import {
  adjacentJalaliMonth,
  jalaliMonthLabel,
  jalaliMonthPeriod,
  parseJalaliMonthParam,
} from "@/features/calendar/jalali";
import {
  monthOfPeriod,
  preferencesHref,
} from "@/features/preferences/presentation";
import { PreferencesView } from "@/features/preferences/preferences-view";
import { PageHeader } from "@/features/shell/page-header";
import { APP_TIMEZONE, todayIn } from "@/infrastructure/auth/actor";

export const metadata: Metadata = { title: "ترجیحات" };

/** Months are Jalali calendar months; the query only sees ISO periods. */
const JALALI_MONTHS: PreferenceMonthCalendar = {
  monthOf: (date) =>
    jalaliMonthPeriod(monthOfPeriod({ start: date, end: date })),
};

/**
 * The signed-in nurse's own preferences (Head Nurses included when rostered),
 * one Jalali month at a time.
 * - `?month=1405-09` picks the month; by default, the earliest month whose
 *   preference collection is open for the nurse, else the current month.
 * - `?schedule=<id>` (from a PREFERENCES_OPENED notification) selects a
 *   schedule and its month; the query authorizes it and never trusts the link.
 * Invalid values are ignored.
 */
export default async function PreferencesPage({
  searchParams,
}: PageProps<"/preferences">) {
  const ctx = await requireRequestContext();
  const params = await searchParams;
  const scheduleId =
    typeof params.schedule === "string" ? params.schedule : undefined;
  const requestedMonth = parseJalaliMonthParam(params.month);
  const today = todayIn(APP_TIMEZONE);
  const page = await getMyPreferencesPage(ctx, {
    scheduleId,
    month: requestedMonth ? jalaliMonthPeriod(requestedMonth) : undefined,
    today,
    calendar: JALALI_MONTHS,
  });

  const month = monthOfPeriod(page.month);
  const neighbour = (direction: "previous" | "next") => {
    const target = adjacentJalaliMonth(month, direction);
    return target
      ? { href: preferencesHref(target), label: jalaliMonthLabel(target) }
      : null;
  };

  return (
    <>
      <PageHeader
        title="ترجیحات"
        description="ترجیح شیفت خود را برای روزهای هر ماه ثبت کنید. ترجیح، درخواست شماست و شیفت قطعی نیست."
      />
      <PreferencesView
        page={page}
        month={month}
        previous={neighbour("previous")}
        next={neighbour("next")}
        today={today}
      />
    </>
  );
}
