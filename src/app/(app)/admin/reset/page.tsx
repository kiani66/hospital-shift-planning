import { requireRequestContext } from "@/features/auth/guards";
import { managementPageRead } from "@/features/management/page-read";
import {
  requireResetAdmin,
  getResetDepartmentOptions,
} from "@/application/reset/preview";
import { PageHeader } from "@/features/shell/page-header";
import { FullResetControl } from "@/features/reset/full-control";
import { MasterRecoveryControl } from "@/features/reset/recovery-control";
export const metadata = { title: "بازنشانی داده آزمایشی" };
export default async function ResetPage() {
  const ctx = await requireRequestContext();
  await managementPageRead(requireResetAdmin(ctx));
  const options = await managementPageRead(getResetDepartmentOptions(ctx));
  return (
    <>
      <PageHeader
        title="بازنشانی داده آزمایشی"
        description="انتخاب دامنه و داده، بررسی اثر و تأیید پیش از حذف"
      />
      <FullResetControl departments={options} />
      <MasterRecoveryControl />
    </>
  );
}
