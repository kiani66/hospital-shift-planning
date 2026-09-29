import type { Metadata } from "next";

import { requireRequestContext } from "@/features/auth/guards";
import { NotYetImplemented, PageHeader } from "@/features/shell/page-header";

export const metadata: Metadata = { title: "ترجیحات" };

export default async function PreferencesPage() {
  await requireRequestContext();
  return (
    <>
      <PageHeader
        title="ترجیحات"
        description="ثبت ترجیحات شیفت شما برای ماه آینده."
      />
      <NotYetImplemented plannedFor="در فاز ترجیحات" />
    </>
  );
}
