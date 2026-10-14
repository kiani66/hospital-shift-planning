"use client";

import {
  CircleAlert,
  CircleCheck,
  Download,
  FileSpreadsheet,
  Info,
  TriangleAlert,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";

import type { TemplateInspection } from "@/application/excel-export/template-workbook";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MetadataList } from "@/components/ui/metadata";
import { faNumber } from "@/features/calendar/jalali";

import {
  previewTemplateAction,
  saveTemplateAction,
  type TemplatePreviewState,
  type TemplateSaveState,
} from "./actions";

/** The stored template as the page shows it (serializable). */
export interface StoredTemplateView {
  readonly id: string;
  readonly version: number;
  readonly revision: number;
  readonly fileName: string;
  readonly byteSize: number;
  readonly uploadedAt: string;
  readonly uploadedByName: string | null;
  readonly mappingUpdatedAt: string | null;
  readonly mapping: {
    readonly sheetName: string;
    readonly personnelColumn: string;
    readonly firstRow: number;
    readonly lastRow: number;
    readonly firstDayColumn: string;
  };
  readonly inspection: TemplateInspection;
}

const kib = (bytes: number) =>
  `${faNumber(Math.max(1, Math.round(bytes / 1024)))} کیلوبایت`;

/** Mapping summary: where the exporter reads and writes. */
function MappingSummary({ inspection }: { inspection: TemplateInspection }) {
  const m = inspection.mapping;
  if (!m) return null;
  return (
    <MetadataList
      items={[
        ["برگه", <bdi key="s">{m.sheetName}</bdi>],
        [
          "شماره پرسنلی",
          <span key="p">
            <bdi dir="ltr">{inspection.personnelRange}</bdi>
            {inspection.personnelColumnHidden && " (ستون پنهان)"}
          </span>,
        ],
        [
          "خانه‌های روزانه",
          <span key="d">
            <bdi dir="ltr">{inspection.dayRange}</bdi> — ۳۱ ستون، روز ۱ در ستون{" "}
            <bdi dir="ltr">{m.firstDayColumn}</bdi>
          </span>,
        ],
        ["پرسنل یافت‌شده", faNumber(inspection.personnel.length)],
      ]}
    />
  );
}

function Issues({ inspection }: { inspection: TemplateInspection }) {
  return (
    <>
      {inspection.errors.length > 0 && (
        <div
          role="alert"
          className="space-y-2 rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
        >
          <p className="font-semibold">این قالب قابل فعال‌سازی نیست:</p>
          <ul className="list-inside list-disc space-y-1">
            {inspection.errors.map((issue, i) => (
              <li key={i}>
                {issue.cell && (
                  <>
                    <bdi dir="ltr" className="font-mono">
                      {issue.cell}
                    </bdi>
                    {" — "}
                  </>
                )}
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {inspection.warnings.length > 0 && (
        <Callout tone="attention" icon={TriangleAlert} as="div">
          <ul className="list-inside list-disc space-y-1">
            {inspection.warnings.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </Callout>
      )}
    </>
  );
}

function PersonnelList({ inspection }: { inspection: TemplateInspection }) {
  if (inspection.personnel.length === 0) return null;
  return (
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        ردیف‌های پرسنل ({faNumber(inspection.personnel.length)})
      </summary>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        {inspection.personnel.map((p) => (
          <li key={p.cell}>
            <bdi dir="ltr" className="font-mono">
              {p.cell}
            </bdi>
            {": "}
            <bdi dir="ltr">{p.personnelNumber}</bdi>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * «قالب خروجی اکسل» (D124): the stored template and its status, and one form
 * to upload a first template, replace it, or change its mapping. Every save
 * is checked first («بررسی قالب»), shows the mapping summary and is
 * validated again on the server; replacing asks for confirmation.
 */
export function ExcelTemplateManager({
  department,
  template,
}: {
  department: { id: string; code: string; name: string };
  template: StoredTemplateView | null;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<TemplatePreviewState>({
    status: "idle",
  });
  const [saved, setSaved] = useState<TemplateSaveState>({ status: "idle" });
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [operation, setOperation] = useState<"preview" | "save">("preview");
  const ids = {
    file: useId(),
    sheet: useId(),
    personnel: useId(),
    first: useId(),
    last: useId(),
    day: useId(),
    help: useId(),
  };
  const m = template?.mapping;
  const ready = preview.status === "preview" && preview.inspection.valid;
  const replacing = ready && preview.withFile && template !== null;
  const saveLabel = !template
    ? "بارگذاری قالب"
    : replacing
      ? "جایگزینی قالب"
      : "ذخیره تنظیمات";

  const runPreview = () =>
    start(async () => {
      setOperation("preview");
      setSaved({ status: "idle" });
      setPreview(await previewTemplateAction(new FormData(formRef.current!)));
    });
  const runSave = () =>
    start(async () => {
      setOperation("save");
      const data = new FormData(formRef.current!);
      if (confirmRef.current?.checked) data.set("confirm", "on");
      const result = await saveTemplateAction(data);
      setSaved(result);
      setConfirming(false);
      if (result.status === "saved") {
        setPreview({ status: "idle" });
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-5">
      {template ? (
        <div className="space-y-4 rounded-xl border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <FileSpreadsheet aria-hidden className="size-5 text-primary" />
            <span className="font-semibold">
              <bdi>{template.fileName}</bdi>
            </span>
            {template.inspection.valid ? (
              <Badge tone="valid" icon={CircleCheck}>
                فعال و معتبر
              </Badge>
            ) : (
              <Badge tone="destructive" icon={CircleAlert}>
                فعال، نیازمند اصلاح
              </Badge>
            )}
            <a
              className={buttonClasses("outline", "ms-auto")}
              href={`/api/departments/${encodeURIComponent(department.code)}/excel-template`}
              download
            >
              <Download aria-hidden className="size-4" />
              دانلود قالب فعلی
            </a>
          </div>
          <MetadataList
            items={[
              ["نسخه", faNumber(template.version)],
              ["زمان بارگذاری", template.uploadedAt],
              ["بارگذاری توسط", template.uploadedByName ?? "—"],
              ["حجم", kib(template.byteSize)],
              ...(template.mappingUpdatedAt
                ? ([["آخرین تغییر نگاشت", template.mappingUpdatedAt]] as const)
                : []),
            ]}
          />
          <MappingSummary inspection={template.inspection} />
          {!template.inspection.valid && (
            <Issues inspection={template.inspection} />
          )}
        </div>
      ) : (
        <Callout tone="info" icon={Info}>
          هنوز قالبی برای این بخش بارگذاری نشده است. فایل Excel آماده بیمارستان
          را انتخاب و محل شماره‌های پرسنلی و ستون روز اول را مشخص کنید؛ تا آن
          زمان «خروجی اکسل» برنامه ماهانه در دسترس نیست.
        </Callout>
      )}

      <form
        // A saved template or mapping remounts the form with its new values.
        key={`${template?.id ?? "none"}:${template?.revision ?? 0}`}
        ref={formRef}
        aria-label="فایل قالب و نگاشت"
        aria-describedby={ids.help}
        className="space-y-4 rounded-xl border p-4"
        onChange={() => {
          // Any change invalidates the summary: the user checks again.
          if (preview.status !== "idle") setPreview({ status: "idle" });
          if (saved.status !== "idle") setSaved({ status: "idle" });
        }}
        onSubmit={(event) => {
          event.preventDefault();
          runPreview();
        }}
      >
        <input type="hidden" name="departmentId" value={department.id} />
        <input type="hidden" name="departmentCode" value={department.code} />
        <input
          type="hidden"
          name="expectedTemplateId"
          value={template?.id ?? ""}
        />
        <input
          type="hidden"
          name="expectedRevision"
          value={template?.revision ?? 0}
        />
        <p id={ids.help} className="text-sm text-muted-foreground">
          {template
            ? "برای جایگزینی فایل جدید انتخاب کنید؛ برای تغییر نگاشت قالب فعلی فایل را خالی بگذارید."
            : "فایل قالب و نگاشت آن را وارد کنید."}{" "}
          ۳۱ ستون روزانه پشت سر هم از ستون روز اول خوانده می‌شوند. شماره پرسنلی
          تنها کلید تطبیق است؛ شماره‌های دارای صفر آغازین را به صورت متن ذخیره
          کنید.
        </p>
        <div className="flex flex-col gap-2">
          <Label htmlFor={ids.file}>فایل قالب Excel</Label>
          <Input
            id={ids.file}
            name="file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required={!template}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor={ids.sheet}>نام Sheet</Label>
            <Input
              id={ids.sheet}
              name="sheetName"
              required
              maxLength={31}
              defaultValue={m?.sheetName ?? ""}
              placeholder="Sheet1"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={ids.personnel}>ستون شماره پرسنلی</Label>
            <Input
              id={ids.personnel}
              name="personnelColumn"
              required
              dir="ltr"
              maxLength={3}
              pattern="[A-Za-z]{1,3}"
              defaultValue={m?.personnelColumn ?? ""}
              placeholder="B"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={ids.first}>ردیف شروع پرسنل</Label>
            <Input
              id={ids.first}
              name="firstRow"
              type="number"
              required
              min={1}
              dir="ltr"
              defaultValue={m?.firstRow ?? ""}
              placeholder="7"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={ids.last}>ردیف پایان پرسنل</Label>
            <Input
              id={ids.last}
              name="lastRow"
              type="number"
              required
              min={1}
              dir="ltr"
              defaultValue={m?.lastRow ?? ""}
              placeholder="40"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={ids.day}>ستون روز اول</Label>
            <Input
              id={ids.day}
              name="firstDayColumn"
              required
              dir="ltr"
              maxLength={3}
              pattern="[A-Za-z]{1,3}"
              defaultValue={m?.firstDayColumn ?? ""}
              placeholder="M"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="outline" disabled={pending}>
            {pending && operation === "preview"
              ? "در حال بررسی…"
              : "بررسی قالب"}
          </Button>
          <Button
            disabled={pending || !ready}
            onClick={() => {
              if (!replacing) return runSave();
              // Each replacement is confirmed afresh.
              if (confirmRef.current) confirmRef.current.checked = false;
              setConfirming(true);
            }}
          >
            {pending && operation === "save" ? "در حال ذخیره…" : saveLabel}
          </Button>
        </div>

        {preview.status === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {preview.message}
          </p>
        )}
        {preview.status === "preview" && (
          <section
            aria-label="خلاصه نگاشت"
            className="space-y-3 rounded-lg bg-muted/40 p-3"
          >
            <p className="font-semibold">
              {preview.inspection.valid
                ? "خلاصه نگاشت — قالب قابل فعال‌سازی است"
                : "خلاصه نگاشت"}
            </p>
            <MappingSummary inspection={preview.inspection} />
            <Issues inspection={preview.inspection} />
            <PersonnelList inspection={preview.inspection} />
          </section>
        )}
        {saved.status !== "idle" && (
          <p
            role={saved.status === "error" ? "alert" : "status"}
            className={
              saved.status === "error"
                ? "text-sm text-destructive"
                : "text-sm text-health-valid-foreground"
            }
          >
            {saved.message}
          </p>
        )}
      </form>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        preventClose={pending}
        title="جایگزینی قالب فعلی"
        description={
          <>
            قالب «<bdi>{template?.fileName}</bdi>» با فایل جدید جایگزین می‌شود و
            خروجی‌های بعدی از قالب جدید ساخته می‌شوند. قالب فعلی فقط در صورت
            موفقیت ذخیره کنار گذاشته می‌شود.
          </>
        }
      >
        <label className="flex items-start gap-2 text-sm">
          <input
            ref={confirmRef}
            type="checkbox"
            className="mt-1 size-4"
            required
          />
          جایگزینی قالب فعلی را تأیید می‌کنم.
        </label>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            انصراف
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              if (!confirmRef.current?.checked) {
                confirmRef.current?.reportValidity();
                return;
              }
              runSave();
            }}
          >
            {pending ? "در حال ذخیره…" : "جایگزینی قالب"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
