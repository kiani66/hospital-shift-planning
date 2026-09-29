import type { Metadata } from "next";

import { requireRequestContext } from "@/features/auth/guards";
import { NotYetImplemented, PageHeader } from "@/features/shell/page-header";
import { ShiftLegend } from "@/features/shell/shift-legend";

export const metadata: Metadata = { title: "شیفت‌های من" };

export default async function MyShiftsPage() {
  await requireRequestContext();
  return (
    <>
      <PageHeader
        title="شیفت‌های من"
        description="برنامه شیفت‌های شما در ماه‌های مختلف."
      />
      <section aria-labelledby="legend-title" className="mb-6">
        <h2 id="legend-title" className="mb-3 text-sm font-semibold">
          راهنمای شیفت‌ها
        </h2>
        <ShiftLegend />
      </section>
      <NotYetImplemented plannedFor="در فاز نمایش برنامه" />
    </>
  );
}
