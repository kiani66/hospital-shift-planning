import type { Metadata } from "next";
import Link from "next/link";
import { getMembershipFormOptions } from "@/application/management/personnel-queries";

import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { requireRequestContext } from "@/features/auth/guards";
import { formatJalaliDateTime } from "@/features/calendar/jalali";
import { readPersonPage } from "@/features/management/page-queries";
import { AccountControls } from "@/features/management/account-controls";
import { managementPageRead } from "@/features/management/page-read";
import { MembershipControls } from "@/features/management/membership-controls";
import {
  AccountStatus,
  RelationsSection,
} from "@/features/management/relations";
import { PageHeader } from "@/features/shell/page-header";

export const metadata: Metadata = { title: "اطلاعات کاربر" };

export default async function PersonPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const ctx = await requireRequestContext();
  const user = await readPersonPage((await params).userId);
  const options = await managementPageRead(getMembershipFormOptions(ctx));
  return (
    <div className="space-y-6">
      <Link href="/admin/personnel" className={buttonClasses("outline")}>
        بازگشت به کاربران بیمارستان
      </Link>
      <PageHeader
        title={user.displayName}
        description="اطلاعات حساب، مدیریت عضویت و تاریخچه دسترسی."
      />
      <section
        aria-label="اطلاعات حساب"
        className="space-y-4 rounded-xl border bg-card p-5"
      >
        <div className="flex flex-wrap gap-2">
          <AccountStatus active={user.isActive} />
          <Badge tone="brand-soft">
            {user.isHospitalAdmin
              ? "مدیر بیمارستان"
              : "بدون نقش مدیر بیمارستان"}
          </Badge>
        </div>
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="mb-1 text-sm text-muted-foreground">
              ایمیل / شناسه ورود
            </dt>
            <dd dir="ltr" className="text-end break-all">
              {user.email}
            </dd>
          </div>
          <div>
            <dt className="mb-1 text-sm text-muted-foreground">ایجاد حساب</dt>
            <dd>
              <time dateTime={user.createdAt.toISOString()}>
                {formatJalaliDateTime(user.createdAt, "Asia/Tehran")}
              </time>
            </dd>
          </div>
          <div>
            <dt className="mb-1 text-sm text-muted-foreground">
              آخرین به‌روزرسانی حساب
            </dt>
            <dd>
              <time dateTime={user.updatedAt.toISOString()}>
                {formatJalaliDateTime(user.updatedAt, "Asia/Tehran")}
              </time>
            </dd>
          </div>
        </dl>
        <p className="text-sm text-muted-foreground">
          وضعیت حساب مستقل از روابط است؛ حساب غیرفعال دسترسی ورود ندارد.
        </p>
        <AccountControls
          user={{
            id: user.id,
            displayName: user.displayName,
            email: user.email,
            isActive: user.isActive,
          }}
        />
      </section>
      <MembershipControls
        userId={user.id}
        memberships={user.memberships.filter((r) => r.status === "CURRENT")}
        options={options}
      />
      <RelationsSection
        id="current-supervisors"
        title="نظارت‌های جاری"
        relations={user.supervisors.filter((r) => r.status === "CURRENT")}
      />
      <RelationsSection
        id="membership-history"
        title="تاریخچه عضویت"
        relations={user.memberships}
      />
      <RelationsSection
        id="supervisor-history"
        title="تاریخچه نظارت"
        relations={user.supervisors}
      />
    </div>
  );
}
