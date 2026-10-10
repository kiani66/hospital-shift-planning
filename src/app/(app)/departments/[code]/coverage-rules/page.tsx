import { MissingShiftReference } from "@/features/shifts/missing-reference";
import { CircleCheck } from "lucide-react";
import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";

import { NotFoundError } from "@/application/errors";
import { previewRuleSetApplication } from "@/application/staffing-rules/apply";
import { getDepartmentCoverageRules } from "@/application/staffing-rules/department";
import { Callout } from "@/components/ui/callout";
import { requireRequestContext } from "@/features/auth/guards";
import { requireDepartmentPage } from "@/features/shell/department-page";
import { PageHeader } from "@/features/shell/page-header";
import {
  ApplyPreview,
  DepartmentCoverageRulesView,
} from "@/features/staffing-rules/department-view";
import { loadOptionalShiftLabels } from "@/features/shifts/labels";

export const metadata: Metadata = { title: "قوانین پوشش بخش" };

/**
 * The department's staffing rule sets (D108 `staffingRules.view`): its Head
 * Nurse reads; its Supervisors and Hospital Admins may also preview and
 * apply another version to a schedule (`?schedule=&target=`).
 */
export default async function DepartmentCoverageRulesPage({
  params,
  searchParams,
}: PageProps<"/departments/[code]/coverage-rules">) {
  const department = await requireDepartmentPage(params, "staffingRules.view");
  const ctx = await requireRequestContext();
  const shiftLabels = await loadOptionalShiftLabels();
  if (!shiftLabels) return <MissingShiftReference />;
  const { schedule, target, applied } = await searchParams;
  const orNotFound = (error: unknown): never => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  };
  const data = await getDepartmentCoverageRules(ctx, {
    departmentId: department.id,
  }).catch(orNotFound);
  const pageHref = `/departments/${department.code}/coverage-rules` as Route;
  const preview =
    data.canApply && typeof schedule === "string" && typeof target === "string"
      ? await previewRuleSetApplication(ctx, {
          departmentId: department.id,
          scheduleId: schedule,
          targetVersionId: target,
        }).catch(orNotFound)
      : null;
  return (
    <>
      <PageHeader
        title={`قوانین پوشش نفرات — ${department.name}`}
        description="حداقل و حداکثر نفرات صبح، عصر و شب که هر برنامه با آن سنجیده می‌شود."
      />
      {typeof applied === "string" && (
        <Callout
          role="status"
          tone="success"
          icon={CircleCheck}
          className="mb-4"
        >
          نسخه انتخابی بر برنامه اعمال شد. شیفت‌ها تغییری نکرده‌اند؛ اعتبارسنجی
          برنامه اکنون با قوانین تازه انجام می‌شود.
        </Callout>
      )}
      <DepartmentCoverageRulesView
        data={data}
        departmentName={department.name}
        pageHref={pageHref}
        selectedScheduleId={preview?.scheduleId ?? null}
        shiftLabels={shiftLabels}
        preview={
          preview && (
            <ApplyPreview
              preview={preview}
              departmentName={department.name}
              departmentCode={department.code}
              closeHref={pageHref}
              shiftLabels={shiftLabels}
            />
          )
        }
      />
    </>
  );
}
