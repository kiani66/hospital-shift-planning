"use client";

import { Download, ListChecks } from "lucide-react";
import { useId, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { faNumber } from "@/features/calendar/jalali";

import {
  describeTemplateRowsAction,
  preparePersonnelColumnAction,
  type PreparedTemplateState,
  type TemplateRowsState,
} from "./actions";

const ROLE_LABELS = {
  HEAD_NURSE: "سرپرستار",
  NURSE: "پرستار",
  SECRETARY: "منشی",
} as const;

const XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * «ساخت ستون شماره پرسنلی» (D124): the hospital's workbook has names but no
 * personnel numbers. The user chooses, for each printed row, the person it
 * belongs to from the department's records; the server writes those
 * people's recorded numbers into an empty column and hides it, without
 * moving anything that prints. Names are only shown to recognise a row,
 * never matched. The prepared file is downloaded for review and then
 * uploaded as the template above; nothing is stored here.
 */
export function PersonnelColumnPreparer({
  department,
}: {
  department: { id: string; code: string };
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [rows, setRows] = useState<TemplateRowsState>({ status: "idle" });
  const [prepared, setPrepared] = useState<PreparedTemplateState>({
    status: "idle",
  });
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const [pending, start] = useTransition();
  const ids = {
    file: useId(),
    sheet: useId(),
    first: useId(),
    last: useId(),
    day: useId(),
    column: useId(),
  };

  const taken = new Set(Object.values(chosen).filter(Boolean));
  const reset = () => {
    if (prepared.status !== "idle") setPrepared({ status: "idle" });
  };

  return (
    <details className="rounded-xl border p-4">
      <summary className="cursor-pointer font-semibold">
        <ListChecks aria-hidden className="me-2 inline size-4 text-primary" />
        ساخت ستون شماره پرسنلی پنهان از روی پرونده پرسنل
      </summary>
      <form
        ref={formRef}
        aria-label="ساخت ستون شماره پرسنلی"
        className="mt-4 space-y-4"
        onChange={reset}
        onSubmit={(event) => {
          event.preventDefault();
          start(async () => {
            setPrepared({ status: "idle" });
            setChosen({});
            setRows(
              await describeTemplateRowsAction(new FormData(formRef.current!)),
            );
          });
        }}
      >
        <p className="text-sm text-muted-foreground">
          اگر فایل بیمارستان ستون شماره پرسنلی ندارد، ردیف هر نفر را به پرونده
          او در سامانه وصل کنید. شماره‌ها فقط از پرونده پرسنلی خوانده و در ستونی
          خالی (مثلاً <bdi dir="ltr">BL</bdi>، بیرون از محدوده چاپ) نوشته
          می‌شوند و آن ستون پنهان می‌شود؛ هیچ ستونی جابه‌جا نمی‌شود. نام‌ها فقط
          برای شناختن ردیف نمایش داده می‌شوند و مبنای تطبیق نیستند.
        </p>
        <input type="hidden" name="departmentId" value={department.id} />
        <input type="hidden" name="departmentCode" value={department.code} />
        <div className="flex flex-col gap-2">
          <Label htmlFor={ids.file}>فایل Excel بیمارستان</Label>
          <Input
            id={ids.file}
            name="file"
            type="file"
            accept={`.xlsx,${XLSX}`}
            required
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor={ids.sheet}>نام Sheet</Label>
            <Input
              id={ids.sheet}
              name="sheetName"
              required
              placeholder="Sheet2"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={ids.first}>ردیف شروع پرسنل</Label>
            <Input
              id={ids.first}
              name="firstRow"
              type="number"
              min={1}
              required
              dir="ltr"
              placeholder="7"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={ids.last}>ردیف پایان پرسنل</Label>
            <Input
              id={ids.last}
              name="lastRow"
              type="number"
              min={1}
              required
              dir="ltr"
              placeholder="23"
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
              placeholder="M"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={ids.column}>ستون خالی برای شماره پرسنلی</Label>
            <Input
              id={ids.column}
              name="targetColumn"
              required
              dir="ltr"
              maxLength={3}
              pattern="[A-Za-z]{1,3}"
              placeholder="BL"
            />
          </div>
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending && rows.status !== "rows"
            ? "در حال خواندن…"
            : "خواندن ردیف‌ها"}
        </Button>
        {rows.status === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {rows.message}
          </p>
        )}
        {rows.status === "rows" && (
          <div className="space-y-3">
            <table className="w-full text-sm">
              <caption className="pb-2 text-start font-medium">
                فرد هر ردیف را انتخاب کنید؛ ردیف‌های عنوان و خالی را بدون انتخاب
                بگذارید.
              </caption>
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th scope="col" className="py-1 text-start">
                    ردیف
                  </th>
                  <th scope="col" className="py-1 text-start">
                    متن ردیف در فایل
                  </th>
                  <th scope="col" className="py-1 text-start">
                    فرد در سامانه
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.rows.map((r) => (
                  <tr key={r.row} className="border-b last:border-0">
                    <td className="py-1">{faNumber(r.row)}</td>
                    <td className="py-1">
                      <bdi>{r.label}</bdi>
                    </td>
                    <td className="py-1">
                      <select
                        name={`person-${r.row}`}
                        aria-label={`فرد ردیف ${faNumber(r.row)}`}
                        className="w-full rounded-md border bg-background px-2 py-1"
                        value={chosen[r.row] ?? ""}
                        onChange={(event) =>
                          setChosen((current) => ({
                            ...current,
                            [r.row]: event.target.value,
                          }))
                        }
                      >
                        <option value="">— بدون فرد —</option>
                        {rows.personnel.map((p) => (
                          <option
                            key={p.userId}
                            value={p.userId}
                            disabled={
                              !p.personnelNumber ||
                              (taken.has(p.userId) &&
                                chosen[r.row] !== p.userId)
                            }
                          >
                            {p.displayName} — {ROLE_LABELS[p.role]} —{" "}
                            {p.personnelNumber ?? "بدون شماره پرسنلی"}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Button
              disabled={pending || taken.size === 0}
              onClick={() =>
                start(async () =>
                  setPrepared(
                    await preparePersonnelColumnAction(
                      new FormData(formRef.current!),
                    ),
                  ),
                )
              }
            >
              {pending ? "در حال ساخت…" : "ساخت فایل با ستون شماره پرسنلی"}
            </Button>
          </div>
        )}
        {prepared.status === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {prepared.message}
          </p>
        )}
        {prepared.status === "ready" && (
          <p
            role="status"
            className="flex flex-wrap items-center gap-2 text-sm"
          >
            شماره پرسنلی {faNumber(prepared.rows)} ردیف نوشته شد. فایل را بررسی
            و سپس در فرم بالا به عنوان قالب بارگذاری کنید.
            <a
              href={`data:${XLSX};base64,${prepared.base64}`}
              download={prepared.fileName}
              className="inline-flex items-center gap-1 font-medium text-primary underline"
            >
              <Download aria-hidden className="size-4" />
              دانلود فایل آماده
            </a>
          </p>
        )}
      </form>
    </details>
  );
}
