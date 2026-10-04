import type { Metadata } from "next";
import Link from "next/link";
import { getMembershipFormOptions } from "@/application/management/personnel-queries";

import { buttonClasses } from "@/components/ui/button";
import { requireRequestContext } from "@/features/auth/guards";
import { formatJalaliDateTime } from "@/features/calendar/jalali";
import { readPersonPage } from "@/features/management/page-queries";
import { AccountControls } from "@/features/management/account-controls";
import { IdentityControls } from "@/features/management/identity-controls";
import { managementPageRead } from "@/features/management/page-read";
import { MembershipControls } from "@/features/management/membership-controls";
import { AuthorityControls } from "@/features/management/authority-controls";
import { SupervisorControls } from "@/features/management/supervisor-controls";
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
        </div>
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="mb-1 text-sm text-muted-foreground">شماره پرسنلی</dt>
            <dd>
              {user.personnelNumber ? (
                <span dir="ltr" className="font-mono">
                  {user.personnelNumber}
                </span>
              ) : (
                <span className="text-health-attention-foreground">
                  ثبت نشده (حساب قدیمی؛ شماره واقعی را ثبت کنید)
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="mb-1 text-sm text-muted-foreground">ایمیل</dt>
            <dd dir="ltr" className="text-end break-all">
              {user.email ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="mb-1 text-sm text-muted-foreground">موبایل</dt>
            <dd dir="ltr" className="text-end">
              {user.mobile ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="mb-1 text-sm text-muted-foreground">امکان ورود</dt>
            <dd>
              {!user.hasCredentials
                ? "رمز ندارد؛ تا ساخت رمز موقت امکان ورود ندارد"
                : user.mustChangePassword
                  ? "رمز موقت؛ در ورود بعدی باید تغییر کند"
                  : "رمز تعیین‌شده توسط کاربر"}
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
        <IdentityControls
          user={{
            id: user.id,
            displayName: user.displayName,
            personnelNumber: user.personnelNumber,
            isActive: user.isActive,
            hasCredentials: user.hasCredentials,
            mustChangePassword: user.mustChangePassword,
          }}
          actorId={ctx.actor.userId}
        />
        <AccountControls
          user={{
            id: user.id,
            displayName: user.displayName,
            email: user.email,
            mobile: user.mobile,
            personnelNumber: user.personnelNumber,
            isActive: user.isActive,
          }}
        />
      </section>
      <AuthorityControls
        user={{
          id: user.id,
          displayName: user.displayName,
          isActive: user.isActive,
          isHospitalAdmin: user.isHospitalAdmin,
        }}
        actorId={ctx.actor.userId}
      />
      <MembershipControls
        userId={user.id}
        memberships={user.memberships.filter((r) => r.status === "CURRENT")}
        options={options}
      />
      <SupervisorControls
        userId={user.id}
        relations={user.supervisors.filter((r) => r.status === "CURRENT")}
        options={options}
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
