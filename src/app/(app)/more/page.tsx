import type { Metadata } from "next";

import { getShellContext } from "@/application/workspace/queries";
import { requireRequestContext } from "@/features/auth/guards";
import { NavSections } from "@/features/shell/nav-sections";
import { buildNavigation } from "@/features/shell/navigation";
import { PageHeader } from "@/features/shell/page-header";

export const metadata: Metadata = { title: "همه بخش‌ها" };

/** Every destination, for the items that do not fit the mobile bottom bar. */
export default async function MorePage() {
  const context = await getShellContext(await requireRequestContext());
  return (
    <>
      <PageHeader title="همه بخش‌ها" />
      <nav aria-label="همه بخش‌ها" className="max-w-md">
        <NavSections sections={buildNavigation(context).sections} />
      </nav>
    </>
  );
}
