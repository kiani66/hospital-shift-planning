import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { NotFoundError } from "@/application/errors";
import { getReviewQueue } from "@/application/schedules/supervisor-review";
import { getReviewDepartments } from "@/application/workspace/queries";
import { requireRequestContext } from "@/features/auth/guards";
import { ReviewQueueView } from "@/features/schedule-workflow/review-queue";
import { PageHeader } from "@/features/shell/page-header";

export const metadata: Metadata = { title: "بررسی برنامه‌ها" };

/** Supervisors only (their current assignments are loaded from the database). */
export default async function ReviewPage() {
  const ctx = await requireRequestContext();
  const orNotFound = (error: unknown): never => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  };
  const [departments, queue] = await Promise.all([
    getReviewDepartments(ctx).catch(orNotFound),
    getReviewQueue(ctx).catch(orNotFound),
  ]);

  return (
    <>
      <PageHeader
        title="بررسی برنامه‌ها"
        description="برنامه‌های ماهانه‌ای که سرپرستاران بخش‌های تحت نظارت شما برای تأیید ارسال کرده‌اند."
      />
      <section
        aria-labelledby="supervised-title"
        className="mb-6 flex flex-wrap items-center gap-2"
      >
        <h2
          id="supervised-title"
          className="text-sm font-medium text-muted-foreground"
        >
          بخش‌های تحت نظارت
        </h2>
        <ul className="flex flex-wrap gap-2">
          {departments.map((d) => (
            <li
              key={d.id}
              className="rounded-md border bg-card px-3 py-1 text-sm"
            >
              {d.name}
            </li>
          ))}
        </ul>
      </section>
      <ReviewQueueView awaiting={queue.awaiting} others={queue.others} />
    </>
  );
}
