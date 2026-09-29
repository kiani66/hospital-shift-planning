import type { Metadata } from "next";

import { NavSections } from "@/features/shell/nav-sections";
import { buildNavigation } from "@/features/shell/navigation";
import { PageHeader } from "@/features/shell/page-header";
import { loadShellContext } from "@/features/shell/shell-context";

export const metadata: Metadata = { title: "همه بخش‌ها" };

/** Every destination, for the items that do not fit the mobile bottom bar. */
export default async function MorePage() {
  const context = await loadShellContext();
  return (
    <>
      <PageHeader title="همه بخش‌ها" />
      <nav aria-label="همه بخش‌ها" className="max-w-md">
        <NavSections sections={buildNavigation(context).sections} />
      </nav>
    </>
  );
}
