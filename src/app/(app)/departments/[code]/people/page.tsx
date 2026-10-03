import type { Metadata } from "next";
import { Users } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { requireRequestContext } from "@/features/auth/guards";
import { readDepartmentPeoplePage } from "@/features/management/page-queries";
import { MEMBERSHIP_LABELS } from "@/features/management/presentation";
import { AccountStatus } from "@/features/management/relations";
import { PageHeader } from "@/features/shell/page-header";

export const metadata: Metadata = { title: "افراد بخش" };

export default async function DepartmentPeoplePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  await requireRequestContext();
  const data = await readDepartmentPeoplePage((await params).code);
  const groups = [
    {
      id: "members",
      title: "اعضای جاری بخش",
      people: data.memberships.map((m) => ({
        ...m,
        roleLabel: MEMBERSHIP_LABELS[m.role],
      })),
    },
    {
      id: "supervisors",
      title: "سوپروایزرهای جاری بخش",
      people: data.supervisors.map((s) => ({ ...s, roleLabel: "سوپروایزر" })),
    },
  ];
  return (
    <>
      <PageHeader
        title={`افراد بخش ${data.department.name}`}
        description="افراد دارای رابطه جاری با این بخش؛ فقط خواندنی. حساب‌های غیرفعال نیز با وضعیت حساب نمایش داده می‌شوند."
      />
      <div className="space-y-6">
        {groups.map((group) => (
          <section
            key={group.id}
            aria-labelledby={group.id}
            className="space-y-4"
          >
            <SectionHeader
              id={group.id}
              title={group.title}
              icon={<Users aria-hidden="true" />}
            />
            {group.people.length === 0 ? (
              <EmptyState
                headingLevel={null}
                icon={<Users aria-hidden="true" />}
                title="فردی با رابطه جاری وجود ندارد"
                description="روابط آینده و پایان‌یافته در فهرست جاری نمایش داده نمی‌شوند."
              />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {group.people.map((p) => (
                  <li
                    key={p.userId}
                    className="space-y-3 rounded-xl border bg-card p-4"
                  >
                    <p className="font-semibold">{p.displayName}</p>
                    <p className="text-sm text-muted-foreground">
                      {p.roleLabel} · جاری
                    </p>
                    <AccountStatus active={p.isActive} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
