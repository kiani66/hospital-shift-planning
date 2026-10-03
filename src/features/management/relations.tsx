import { Users } from "lucide-react";
import type { ReactNode } from "react";

import type {
  AccessRelation,
  MembershipView,
} from "@/application/management/read-model";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { formatJalaliDate } from "@/features/calendar/jalali";

import { MEMBERSHIP_LABELS, RELATION_LABELS } from "./presentation";

export function AccountStatus({ active }: { active: boolean }) {
  return (
    <Badge tone={active ? "active" : "muted"}>
      {active ? "حساب فعال" : "حساب غیرفعال"}
    </Badge>
  );
}

export function RelationSummary({
  memberships,
  supervisors,
}: {
  memberships: readonly MembershipView[];
  supervisors: readonly AccessRelation[];
}) {
  const items = [
    ...memberships.map((m) => ({
      id: m.id,
      text: `${m.department.name} · ${MEMBERSHIP_LABELS[m.role]}`,
      inactive: !m.department.isActive,
    })),
    ...supervisors.map((s) => ({
      id: s.id,
      text: `${s.department.name} · سوپروایزر`,
      inactive: !s.department.isActive,
    })),
  ];
  if (items.length === 0)
    return <p className="text-sm text-muted-foreground">بدون رابطه جاری</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {items.map((item) => (
        <li key={item.id}>
          {item.text}{" "}
          <span className="text-muted-foreground">
            · جاری{item.inactive ? " · بخش غیرفعال" : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function RelationsSection({
  id,
  title,
  relations,
  actions,
  relationActions,
}: {
  id: string;
  title: string;
  relations: readonly (AccessRelation | MembershipView)[];
  actions?: ReactNode;
  relationActions?: Readonly<Record<string, ReactNode>>;
}) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <SectionHeader
        id={id}
        title={title}
        icon={<Users aria-hidden="true" />}
        actions={actions}
      />
      {relations.length === 0 ? (
        <EmptyState
          icon={<Users aria-hidden="true" />}
          headingLevel={null}
          title="رابطه‌ای ثبت نشده است"
          description="برای این بخش اطلاعاتی برای نمایش وجود ندارد."
        />
      ) : (
        <ol className="grid gap-3 sm:grid-cols-2">
          {relations.map((r) => (
            <li key={r.id} className="rounded-xl border bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{r.department.name}</p>
                <Badge
                  tone={
                    r.status === "CURRENT"
                      ? "active"
                      : r.status === "FUTURE"
                        ? "info"
                        : "muted"
                  }
                >
                  {RELATION_LABELS[r.status]}
                </Badge>
              </div>
              <p className="mb-2 text-sm">
                {"role" in r ? MEMBERSHIP_LABELS[r.role] : "سوپروایزر"}
              </p>
              {!r.department.isActive && (
                <p className="mb-2 text-sm text-muted-foreground">
                  بخش غیرفعال
                </p>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">شروع</dt>
                <dd>
                  <time dateTime={r.startedOn}>
                    {formatJalaliDate(r.startedOn)}
                  </time>
                </dd>
                <dt className="text-muted-foreground">پایان (شامل این روز)</dt>
                <dd>
                  {r.endedOn ? (
                    <time dateTime={r.endedOn}>
                      {formatJalaliDate(r.endedOn)}
                    </time>
                  ) : (
                    "بدون تاریخ پایان"
                  )}
                </dd>
              </dl>
              {relationActions?.[r.id] && (
                <div className="mt-4 border-t pt-3">
                  {relationActions[r.id]}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
