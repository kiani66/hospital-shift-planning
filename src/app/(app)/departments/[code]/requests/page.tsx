import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";

import { NotFoundError } from "@/application/errors";
import {
  getChangeRequestQueue,
  getChangeRequestReview,
} from "@/application/change-requests/queries";
import {
  CHANGE_REQUEST_STATUSES,
  type ChangeRequestStatus,
} from "@/domain/change-requests/model";
import type { RequestResolution } from "@/domain/change-requests/plan-change";
import { isAssignmentCode } from "@/domain/shifts/shift-type";
import { requireRequestContext } from "@/features/auth/guards";
import { QueueList, QueueTabs } from "@/features/change-request-review/queue";
import { RequestReview } from "@/features/change-request-review/request-review";
import { RequestReviewDialog } from "@/features/change-request-review/review-dialog";
import { formatJalaliDate } from "@/features/calendar/jalali";
import { REQUEST_TYPE_LABELS } from "@/features/change-requests/presentation";
import { requireDepartmentPage } from "@/features/shell/department-page";
import { PageHeader } from "@/features/shell/page-header";

export const metadata: Metadata = { title: "درخواست‌های بخش" };

const isStatus = (value: unknown): value is ChangeRequestStatus =>
  typeof value === "string" &&
  (CHANGE_REQUEST_STATUSES as readonly string[]).includes(value);

/**
 * The department's Shift Change Request queue (Head Nurse of this department
 * only: `changeRequest.review`; anyone else gets the same 404 as an unknown
 * department). `?status=` picks the tab, `?request=<id>` opens a request's
 * detail with its preview; `?replacement=` / `?shift=` are the Head Nurse's
 * resolution for UNAVAILABLE / OTHER, recomputed on the server.
 */
export default async function DepartmentRequestsPage({
  params,
  searchParams,
}: PageProps<"/departments/[code]/requests">) {
  const department = await requireDepartmentPage(
    params,
    "changeRequest.review",
  );
  const ctx = await requireRequestContext();
  const query = await searchParams;
  const status: ChangeRequestStatus = isStatus(query.status)
    ? query.status
    : "PENDING";
  const requestId =
    typeof query.request === "string" ? query.request : undefined;

  const base = `/departments/${encodeURIComponent(department.code)}/requests`;
  const statusHref = (s: ChangeRequestStatus) =>
    (s === "PENDING" ? base : `${base}?status=${s}`) as Route;
  const detailHref = (id: string) =>
    `${base}?status=${status}&request=${encodeURIComponent(id)}` as Route;

  const resolution: RequestResolution = {
    ...(typeof query.replacement === "string" &&
      query.replacement !== "" && { replacementNurseId: query.replacement }),
    ...(query.shift === "UNDECIDED"
      ? { requesterShift: null }
      : isAssignmentCode(query.shift) && { requesterShift: query.shift }),
  };

  const [queue, review] = await Promise.all([
    getChangeRequestQueue(ctx, { departmentId: department.id, status }),
    requestId
      ? getChangeRequestReview(ctx, {
          departmentId: department.id,
          requestId,
          resolution,
        }).catch((error) => {
          // An unknown or foreign request id is a 404 like the department's.
          if (error instanceof NotFoundError) notFound();
          throw error;
        })
      : null,
  ]);

  return (
    <>
      <PageHeader
        title={`درخواست‌های بخش — ${department.name}`}
        description="درخواست‌های تغییر شیفت پرستاران پس از نهایی شدن برنامه. هر درخواست را بررسی کنید و اعمال یا رد کنید؛ اعمال، برنامه تأییدشده را مستقیم تغییر نمی‌دهد."
      />
      <div className="flex flex-col gap-4">
        <QueueTabs queue={queue} href={statusHref} />
        <QueueList queue={queue} detailHref={detailHref} />
      </div>
      {review && (
        <RequestReviewDialog
          title={`${review.request.requester.displayName} · ${REQUEST_TYPE_LABELS[review.request.type]} · ${formatJalaliDate(review.request.date, { weekday: true })}`}
          closeHref={statusHref(status)}
        >
          <RequestReview
            review={review}
            query={{ status, requestId: review.request.id }}
          />
        </RequestReviewDialog>
      )}
    </>
  );
}
