import type { Metadata } from "next";

import { requireRequestContext } from "@/features/auth/guards";
import { NotYetImplemented, PageHeader } from "@/features/shell/page-header";

export const metadata: Metadata = { title: "اعلان‌ها" };

export default async function NotificationsPage() {
  await requireRequestContext();
  return (
    <>
      <PageHeader title="اعلان‌ها" description="پیام‌ها و اعلان‌های سامانه." />
      <NotYetImplemented plannedFor="در فاز اعلان‌ها" />
    </>
  );
}
