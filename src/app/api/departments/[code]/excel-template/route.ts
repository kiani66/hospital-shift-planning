import { NotFoundError } from "@/application/errors";
import { getExcelTemplateFile } from "@/application/excel-export/templates";
import { XLSX_CONTENT_TYPE } from "@/application/excel-export/template-workbook";
import { getDepartmentForPage } from "@/application/workspace/queries";
import { requireRequestContext } from "@/features/auth/guards";
import { attachmentDisposition } from "@/features/excel-export/file-name";

/** The department's stored Excel export template, byte for byte (`excelTemplate.manage`). */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/departments/[code]/excel-template">,
) {
  const app = await requireRequestContext();
  const { code } = await ctx.params;
  try {
    const department = await getDepartmentForPage(
      app,
      code,
      "excelTemplate.manage",
    );
    const file = await getExcelTemplateFile(app, {
      departmentId: department.id,
    });
    return new Response(Buffer.from(file.content), {
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": attachmentDisposition(file.fileName),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError)
      return new Response("قالب پیدا نشد.", { status: 404 });
    throw error;
  }
}
