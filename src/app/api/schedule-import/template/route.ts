import { scheduleWorkbookTemplate } from "@/application/schedule-import/workbook";
import { isJalaliMonth, jalaliMonthPeriod } from "@/features/calendar/jalali";
import { periodDays } from "@/domain/shared/period";
import { requireRequestContext } from "@/features/auth/guards";

export async function GET(request: Request) {
  await requireRequestContext();
  const params = new URL(request.url).searchParams;
  const month = {
    year: Number(params.get("year")),
    month: Number(params.get("month")),
  };
  if (!isJalaliMonth(month))
    return new Response("ماه معتبر نیست", { status: 400 });
  const bytes = await scheduleWorkbookTemplate(
    periodDays(jalaliMonthPeriod(month)).length,
    params.get("sample") === "1",
  );
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="schedule-${month.year}-${month.month}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
