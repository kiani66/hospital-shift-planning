import type {
  RuleSetAdministration,
  RuleSetScopeView,
  RuleSetVersionView,
} from "@/application/staffing-rules/queries";
import type { Route } from "next";
import Link from "next/link";

import { Callout } from "@/components/ui/callout";
import { Info } from "lucide-react";

import {
  ConfirmRuleSetAction,
  CreateDraftButton,
  DraftEditor,
  PublishDialog,
} from "./admin-controls";
import { contentFormValue, scopeLabel, versionLabel } from "./presentation";
import { RuleSetHistory } from "./history-view";
import { RuleSetVersionCard } from "./version-card";
import type { ShiftLabels } from "@/features/shifts/catalog";

function VersionActions({
  scope,
  version,
  shiftLabels,
}: {
  scope: RuleSetScopeView;
  version: RuleSetVersionView;
  shiftLabels: ShiftLabels;
}) {
  if (version.status === "DRAFT")
    return (
      <div className="flex w-full flex-col gap-3">
        <details className="rounded-lg border p-2" open>
          <summary className="cursor-pointer text-sm font-medium">
            ویرایش پیش‌نویس
          </summary>
          <div className="mt-3">
            <DraftEditor
              versionId={version.id}
              revision={version.revision}
              value={contentFormValue(version.content)}
              note={version.note}
              shiftLabels={shiftLabels}
            />
          </div>
        </details>
        <div className="flex flex-wrap gap-2">
          <PublishDialog
            versionId={version.id}
            versionNo={version.versionNo}
            revision={version.revision}
          />
          <ConfirmRuleSetAction
            action="discard"
            fields={{
              versionId: version.id,
              expectedRevision: String(version.revision),
            }}
            triggerLabel="حذف پیش‌نویس"
            title={`حذف ${versionLabel(version.versionNo)} (پیش‌نویس)؟`}
            description="این پیش‌نویس هرگز منتشر نشده و هیچ برنامه‌ای به آن متصل نیست؛ حذف آن ثبت می‌شود."
            confirmLabel="بله، حذف شود"
          />
        </div>
      </div>
    );
  const canDraftFrom = !scope.draftVersionId;
  const canWithdraw =
    version.status === "PUBLISHED" &&
    (scope.departmentId !== null || version.state === "SCHEDULED");
  if (!canDraftFrom && !canWithdraw) return null;
  return (
    <>
      {canDraftFrom && (
        <CreateDraftButton
          departmentId={scope.departmentId}
          basedOnVersionId={version.id}
          label="پیش‌نویس تازه از روی این نسخه"
        />
      )}
      {canWithdraw && (
        <ConfirmRuleSetAction
          action="retire"
          withNote
          fields={{ versionId: version.id }}
          triggerLabel="کنار گذاشتن نسخه"
          title={`کنار گذاشتن ${versionLabel(version.versionNo)}؟`}
          description={
            scope.departmentId === null
              ? "این نسخه زمان‌بندی‌شده دیگر اجرا نمی‌شود و برای برنامه‌های تازه انتخاب نمی‌شود."
              : "این نسخه برای برنامه‌های تازه این بخش انتخاب نمی‌شود و بخش از پیش‌فرض بیمارستان پیروی می‌کند. برنامه‌هایی که به آن متصل‌اند تغییری نمی‌کنند."
          }
          confirmLabel="بله، کنار گذاشته شود"
        />
      )}
    </>
  );
}

function ScopeSection({
  scope,
  names,
  shiftLabels,
}: {
  scope: RuleSetScopeView;
  names: ReadonlyMap<string, string>;
  shiftLabels: ShiftLabels;
}) {
  const title = scopeLabel(scope.departmentName);
  const id = `scope-${scope.departmentCode ?? "hospital"}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        {scope.departmentCode && (
          <Link
            href={
              `/departments/${scope.departmentCode}/coverage-rules` as Route
            }
            className="text-sm text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
          >
            برنامه‌های بخش و اعمال نسخه
          </Link>
        )}
        {!scope.draftVersionId && (
          <CreateDraftButton
            departmentId={scope.departmentId}
            label={
              scope.versions.length === 0
                ? "تعریف قوانین ویژه این بخش"
                : "ساخت پیش‌نویس تازه"
            }
          />
        )}
      </div>
      {scope.versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          این بخش قانون ویژه ندارد و از پیش‌فرض بیمارستان پیروی می‌کند. قانون
          ویژه به‌صورت کامل از روی پیش‌فرض بیمارستان کپی می‌شود و پس از آن مستقل
          است.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {scope.versions.map((v) => (
            <RuleSetVersionCard
              key={v.id}
              version={v}
              names={names}
              shiftLabels={shiftLabels}
              actions={
                <VersionActions
                  scope={scope}
                  version={v}
                  shiftLabels={shiftLabels}
                />
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The Hospital Admin's rule-set management (D105, D108): every scope with
 * its versions, drafts to edit, publication and withdrawal. Schedules are
 * never changed from here; their pins move only through Apply (D107).
 */
export function RuleSetAdminView({
  administration,
  shiftLabels,
}: {
  administration: RuleSetAdministration;
  /** Descriptive shift names (`shift_types.label`), loaded once by the page. */
  shiftLabels: ShiftLabels;
}) {
  return (
    <div className="flex flex-col gap-8">
      <Callout role="note" tone="info" icon={Info}>
        هر برنامه به یک نسخه از قوانین پوشش متصل است. انتشار یا کنار گذاشتن
        نسخه‌ها برنامه‌های موجود را تغییر نمی‌دهد؛ برنامه تازه بر اساس تاریخ
        شروع دوره، نسخه جاری را می‌گیرد. برای تغییر قوانین یک برنامه موجود از
        «اعمال نسخه دیگر» در صفحه قوانین پوشش همان بخش استفاده کنید.
      </Callout>
      {administration.scopes.map((scope) => (
        <ScopeSection
          key={scope.departmentId ?? "hospital"}
          scope={scope}
          names={administration.names}
          shiftLabels={shiftLabels}
        />
      ))}
      <RuleSetHistory
        title="تاریخچه همه نسخه‌ها"
        entries={administration.history}
        names={administration.names}
        departmentName={(id) =>
          id === null
            ? null
            : (administration.scopes.find((s) => s.departmentId === id)
                ?.departmentName ?? "بخش")
        }
      />
    </div>
  );
}
