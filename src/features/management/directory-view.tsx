import { Users } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

import type { getPersonnelDirectory } from "@/application/management/personnel-queries";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { faNumber } from "@/features/calendar/jalali";

import { AccountStatus, RelationSummary } from "./relations";

const selectClasses =
  "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none";

function Filter({
  name,
  label,
  value,
  children,
}: {
  name: string;
  label: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        defaultValue={value}
        className={selectClasses}
      >
        {children}
      </select>
    </div>
  );
}

export function DirectoryView({
  directory,
}: {
  directory: Awaited<ReturnType<typeof getPersonnelDirectory>>;
}) {
  const { filters, departments, users, hasNext } = directory;
  const pageHref = (page: number) => {
    const query = new URLSearchParams({
      search: filters.search,
      active: filters.active,
      admin: filters.admin,
      page: String(page),
    });
    if (filters.departmentId) query.set("departmentId", filters.departmentId);
    if (filters.role) query.set("role", filters.role);
    return `/admin/personnel?${query}` as Route;
  };
  return (
    <div className="space-y-6">
      <form
        method="get"
        action="/admin/personnel"
        aria-label="جستجو و فیلتر کاربران"
        className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        <div className="space-y-2">
          <Label htmlFor="search">جستجو با نام یا ایمیل</Label>
          <Input
            id="search"
            name="search"
            defaultValue={filters.search}
            maxLength={200}
            placeholder="نام یا ایمیل کاربر"
          />
        </div>
        <Filter name="active" label="وضعیت حساب" value={filters.active}>
          <option value="all">همه حساب‌ها</option>
          <option value="active">فعال</option>
          <option value="inactive">غیرفعال</option>
        </Filter>
        <Filter
          name="departmentId"
          label="بخش جاری"
          value={filters.departmentId ?? ""}
        >
          <option value="">همه بخش‌ها</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.isActive ? "" : " (غیرفعال)"}
            </option>
          ))}
        </Filter>
        <Filter name="role" label="نقش عضویت جاری" value={filters.role ?? ""}>
          <option value="">همه نقش‌ها</option>
          <option value="NURSE">پرستار</option>
          <option value="HEAD_NURSE">سرپرستار</option>
        </Filter>
        <Filter name="admin" label="نقش سیستمی" value={filters.admin}>
          <option value="all">همه کاربران</option>
          <option value="admin">مدیر بیمارستان</option>
          <option value="other">سایر کاربران</option>
        </Filter>
        <div className="flex flex-wrap items-end gap-2">
          <Button type="submit">اعمال فیلتر</Button>
          <Link href="/admin/personnel" className={buttonClasses("ghost")}>
            پاک کردن فیلترها
          </Link>
        </div>
      </form>
      <p className="text-sm text-muted-foreground">
        بخش و نقش بر اساس روابط جاری امروز هستند. غیرفعال شدن حساب، عضویت را
        پایان نمی‌دهد.
      </p>
      {users.length === 0 ? (
        <EmptyState
          icon={<Users aria-hidden="true" />}
          title="کاربری یافت نشد"
          description="جستجو یا فیلترها را تغییر دهید."
        />
      ) : (
        <ul aria-label="فهرست کاربران" className="grid gap-3 lg:grid-cols-2">
          {users.map((user) => (
            <li
              key={user.id}
              className="min-w-0 rounded-xl border bg-card p-4 sm:p-5"
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/admin/personnel/${user.id}` as Route}
                  className="rounded-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring"
                >
                  {user.displayName}
                </Link>
                <AccountStatus active={user.isActive} />
              </div>
              <p
                dir="ltr"
                className="mb-3 text-end text-sm break-all text-muted-foreground"
              >
                {user.email}
              </p>
              {user.isHospitalAdmin && (
                <div className="mb-3">
                  <Badge tone="brand-soft">مدیر بیمارستان</Badge>
                </div>
              )}
              <RelationSummary
                memberships={user.memberships}
                supervisors={user.supervisors}
              />
            </li>
          ))}
        </ul>
      )}
      <nav
        aria-label="صفحه‌بندی کاربران"
        className="flex flex-wrap items-center gap-3"
      >
        {filters.page > 1 && (
          <Link
            href={pageHref(filters.page - 1)}
            className={buttonClasses("outline")}
          >
            صفحه قبل
          </Link>
        )}
        <p className="text-sm">
          صفحه {faNumber(filters.page)} · {faNumber(users.length)} کاربر
        </p>
        {hasNext && filters.page < 10000 && (
          <Link
            href={pageHref(filters.page + 1)}
            className={buttonClasses("outline")}
          >
            صفحه بعد
          </Link>
        )}
      </nav>
    </div>
  );
}
