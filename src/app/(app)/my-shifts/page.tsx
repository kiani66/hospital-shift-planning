import type { Metadata } from "next";

import { getMyShiftsMonth } from "@/application/my-shifts/queries";
import { isIsoDate } from "@/domain/shared/dates";
import { isInPeriod } from "@/domain/shared/period";
import { requireRequestContext } from "@/features/auth/guards";
import {
  adjacentJalaliMonth,
  jalaliMonthLabel,
  jalaliMonthParam,
  jalaliMonthPeriod,
  parseJalaliMonthParam,
  toJalali,
  type JalaliMonth,
} from "@/features/calendar/jalali";
import { MyShiftsView } from "@/features/my-shifts/my-shifts-view";
import { myShiftsHref } from "@/features/my-shifts/presentation";
import { PageHeader } from "@/features/shell/page-header";
import { APP_TIMEZONE, todayIn } from "@/infrastructure/auth/actor";

export const metadata: Metadata = { title: "شیفت‌های من" };

/**
 * The signed-in user's own shifts, one Jalali calendar month at a time.
 * `?month=1405-08` picks the month (default: the current one in Tehran) and
 * `?day=<ISO date>` the day whose detail is shown (default: today, when it is
 * in the month); invalid values are ignored. There is no user parameter: the
 * query reads only the actor's own shifts and authorizes every schedule.
 */
export default async function MyShiftsPage({
  searchParams,
}: PageProps<"/my-shifts">) {
  const ctx = await requireRequestContext();
  const params = await searchParams;
  // "Today" is Tehran's calendar day, not the server's (UTC) one.
  const today = todayIn(APP_TIMEZONE);
  const j = toJalali(today);
  const currentMonth: JalaliMonth = { year: j.year, month: j.month };
  const month = parseJalaliMonthParam(params.month) ?? currentMonth;
  const monthParam = jalaliMonthParam(month);
  const period = jalaliMonthPeriod(month);

  const data = await getMyShiftsMonth(ctx, { period, today });

  const requestedDay = isIsoDate(params.day) ? params.day : null;
  const selected =
    requestedDay && isInPeriod(period, requestedDay)
      ? requestedDay
      : isInPeriod(period, today)
        ? today
        : null;

  const neighbour = (direction: "previous" | "next") => {
    const target = adjacentJalaliMonth(month, direction);
    return target
      ? {
          href: myShiftsHref(jalaliMonthParam(target)),
          label: jalaliMonthLabel(target),
        }
      : null;
  };
  const isCurrent = monthParam === jalaliMonthParam(currentMonth);

  return (
    <>
      <PageHeader
        title="شیفت‌های من"
        description="شیفت‌های شما در هر ماه، با ساعت کاری و وضعیت تأیید برنامه."
      />
      <MyShiftsView
        month={data}
        label={jalaliMonthLabel(month)}
        previous={neighbour("previous")}
        next={neighbour("next")}
        currentMonthHref={
          isCurrent ? null : myShiftsHref(jalaliMonthParam(currentMonth))
        }
        today={today}
        selected={selected}
        dayHref={(date) => myShiftsHref(monthParam, date)}
      />
    </>
  );
}
