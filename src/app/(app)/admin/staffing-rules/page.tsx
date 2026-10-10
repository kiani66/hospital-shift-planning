import { MissingShiftReference } from "@/features/shifts/missing-reference";
import type { Metadata } from "next";

import { getRuleSetAdministration } from "@/application/staffing-rules/queries";
import { requireRequestContext } from "@/features/auth/guards";
import { managementPageRead } from "@/features/management/page-read";
import { PageHeader } from "@/features/shell/page-header";
import { RuleSetAdminView } from "@/features/staffing-rules/admin-view";
import { loadOptionalShiftLabels } from "@/features/shifts/labels";

export const metadata: Metadata = { title: "قوانین پوشش نفرات" };

/** Hospital Admin only (`staffingRules.manage`); anyone else gets a 404. */
export default async function StaffingRulesAdminPage() {
  const ctx = await requireRequestContext();
  const administration = await managementPageRead(
    getRuleSetAdministration(ctx),
  );
  const shiftLabels = await loadOptionalShiftLabels();
  if (!shiftLabels) return <MissingShiftReference />;
  return (
    <>
      <PageHeader
        title="قوانین پوشش نفرات"
        description="حداقل و حداکثر نفرات هر نوبت (صبح، عصر، شب) به‌صورت نسخه‌دار: پیش‌فرض بیمارستان و قوانین ویژه هر بخش."
      />
      <RuleSetAdminView
        administration={administration}
        shiftLabels={shiftLabels}
      />
    </>
  );
}
