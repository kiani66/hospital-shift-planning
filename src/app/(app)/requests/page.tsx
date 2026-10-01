import type { Metadata } from "next";

import {
  getChangeRequestOptions,
  getMyChangeRequests,
} from "@/application/change-requests/queries";
import { requireRequestContext } from "@/features/auth/guards";
import { RequestsView } from "@/features/change-requests/requests-view";
import { PageHeader } from "@/features/shell/page-header";

export const metadata: Metadata = { title: "درخواست‌ها" };

/**
 * The signed-in nurse's Shift Change Requests (Head Nurses included, for
 * their own shifts). Everything shown is scoped on the server to the actor:
 * their own requests, swaps that name them, and their own future shifts.
 */
export default async function RequestsPage() {
  const ctx = await requireRequestContext();
  const [options, requests] = await Promise.all([
    getChangeRequestOptions(ctx),
    getMyChangeRequests(ctx),
  ]);
  return (
    <>
      <PageHeader
        title="درخواست‌ها"
        description="درخواست تغییر شیفت پس از نهایی شدن برنامه: ثبت، پیگیری و پاسخ به درخواست جابه‌جایی همکاران."
      />
      <RequestsView options={options} requests={requests} />
    </>
  );
}
