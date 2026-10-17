import { NotFoundError } from "@/application/errors";
import { exportScheduleToExcel } from "@/application/excel-export/export";
import { XLSX_CONTENT_TYPE } from "@/application/excel-export/template-workbook";
import { ValidationError } from "@/domain/shared/errors";
import { requireRequestContext } from "@/features/auth/guards";
import { jalaliExportCalendar } from "@/features/excel-export/calendar";
import {
  attachmentDisposition,
  scheduleExportFileName,
} from "@/features/excel-export/file-name";

const message = (status: number, text: string) =>
  Response.json(
    { message: text },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );

/**
 * Downloads the schedule in the department's Excel template (D124). The use
 * case authorizes every request (`schedule.export`) and only reads; an
 * unknown and a forbidden schedule look the same.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/schedules/[scheduleId]/excel">,
) {
  const app = await requireRequestContext();
  const { scheduleId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(scheduleId))
    return message(404, "برنامه پیدا نشد.");
  const draft =
    new URL(request.url).searchParams.get("source") === "revision-draft";
  try {
    const result = await exportScheduleToExcel(app, {
      scheduleId,
      source: draft ? "REVISION_DRAFT" : "DEFAULT",
      calendar: jalaliExportCalendar,
    });
    return new Response(Buffer.from(result.bytes), {
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": attachmentDisposition(
          scheduleExportFileName(
            result.department.code,
            result.period.start,
            result.source === "REVISION_DRAFT",
          ),
        ),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError)
      return message(404, "برنامه پیدا نشد یا اجازه خروجی آن را ندارید.");
    if (error instanceof ValidationError) return message(422, error.message);
    console.error("[excel-export] unexpected error:", (error as Error).message);
    return message(500, "ساخت فایل Excel ممکن نشد؛ دوباره تلاش کنید.");
  }
}
