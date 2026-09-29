import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { NotFoundError } from "@/application/errors";
import { getReviewDepartments } from "@/application/workspace/queries";
import { requireRequestContext } from "@/features/auth/guards";
import { NotYetImplemented, PageHeader } from "@/features/shell/page-header";

export const metadata: Metadata = { title: "بررسی برنامه‌ها" };

/** Supervisors only (their assignments are loaded from the database). */
export default async function ReviewPage() {
  const ctx = await requireRequestContext();
  const departments = await getReviewDepartments(ctx).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  return (
    <>
      <PageHeader
        title="بررسی برنامه‌ها"
        description="برنامه‌های ارسال‌شده برای تأیید در بخش‌های تحت نظارت شما."
      />
      <section aria-labelledby="supervised-title" className="mb-6">
        <h2 id="supervised-title" className="mb-3 text-sm font-semibold">
          بخش‌های تحت نظارت
        </h2>
        <ul className="flex flex-wrap gap-2">
          {departments.map((d) => (
            <li key={d.id} className="rounded-md border px-3 py-1.5 text-sm">
              {d.name}
            </li>
          ))}
        </ul>
      </section>
      <NotYetImplemented plannedFor="در فاز تأیید برنامه" />
    </>
  );
}
