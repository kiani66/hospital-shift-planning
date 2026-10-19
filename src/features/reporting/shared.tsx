import { AlertTriangle, CheckCircle2, ClipboardList } from "lucide-react";

import type { ScheduleReportProvenance } from "@/application/reporting/schedule-snapshot";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { faNumber, formatJalaliDateTime } from "@/features/calendar/jalali";

export const selectClasses =
  "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none";

export const SOURCE_LABELS: Record<ScheduleReportProvenance["source"], string> =
  {
    APPROVED_VERSION: "نسخه رسمی تأییدشده",
    WORKING_COPY: "گزارش موقت برنامه",
    REVISION_DRAFT: "پیش‌نویس اصلاحات — تأییدنشده",
  };

export function ReportUnavailable({
  description,
  action,
}: {
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <EmptyState
      icon={<ClipboardList />}
      title="گزارش در دسترس نیست"
      description={description}
      action={action}
    />
  );
}

/** Displays the selected snapshot only; never selects or loads another source. */
export function ReportProvenance({
  provenance,
}: {
  provenance: ScheduleReportProvenance;
}) {
  return (
    <Callout
      as="div"
      tone={provenance.isProvisional ? "attention" : "success"}
      icon={provenance.isProvisional ? AlertTriangle : CheckCircle2}
    >
      <p className="font-bold">{SOURCE_LABELS[provenance.source]}</p>
      {provenance.isProvisional && (
        <p>این داده‌ها تأییدنشده‌اند و ممکن است تغییر کنند.</p>
      )}
      {provenance.approvedVersion && (
        <p className="mt-1 text-xs">
          {provenance.source === "REVISION_DRAFT" ? "نسخه رسمی مبنا" : "نسخه"}{" "}
          {faNumber(provenance.approvedVersion.versionNo)} · تأیید در{" "}
          {formatJalaliDateTime(
            provenance.approvedVersion.approvedAt,
            "Asia/Tehran",
          )}
        </p>
      )}
    </Callout>
  );
}
