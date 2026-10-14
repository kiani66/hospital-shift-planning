import {
  CalendarRange,
  Hospital,
  MoonStar,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

import { SHIFT_CODES, type ShiftCode } from "@/domain/shifts/shift-type";
import { BrandMark, PRODUCT_NAME } from "@/features/shell/brand-mark";
import {
  SHIFT_PRESENTATION,
  type ShiftLabels,
} from "@/features/shifts/catalog";
import { cn } from "@/lib/utils";

/** What the product does, in the words the app itself uses. No claims. */
const HIGHLIGHTS: readonly { icon: LucideIcon; text: string }[] = [
  {
    icon: CalendarRange,
    text: "برنامه ماهانه شیفت‌های بخش بر پایه تقویم شمسی",
  },
  { icon: MoonStar, text: "بررسی استراحت پس از شیفت شب و پوشش نفرات هر روز" },
  { icon: SlidersHorizontal, text: "ثبت ترجیحات پرستاران پیش از چیدن برنامه" },
];

/** Saturday-first weekday initials (decoration only). */
const WEEKDAYS = ["ش", "ی", "د", "س", "چ", "پ", "ج"] as const;

/**
 * An illustrative week for the decorative preview: two rows of codes,
 * `null` for a day off. Every night is followed by rest, as the real rule
 * requires, so the picture never shows something the app would flag.
 */
const SAMPLE_WEEK: readonly (readonly (ShiftCode | null)[])[] = [
  ["M", "M", "E", "N", null, "M", "E"],
  ["E", "N", null, "M", "ME", null, "M"],
];

/**
 * A glimpse of a monthly schedule in the app's own shift tokens, so the
 * panel shows the product instead of describing it. `aria-hidden`: the
 * accessible content is the legend below it. Compact enough for an ordinary
 * laptop window (600px tall and up); hidden below that, so the panel never
 * scrolls.
 */
function SchedulePreview() {
  return (
    <div
      aria-hidden="true"
      className="hidden rounded-xl border border-sidebar-border bg-sidebar-accent/45 p-3 shadow-lg shadow-black/10 backdrop-blur-sm [@media(min-height:37.5rem)]:block"
    >
      <div className="grid grid-cols-7 gap-1.5 text-center">
        {WEEKDAYS.map((day) => (
          <span
            key={day}
            className="pb-1 text-[0.6875rem] text-sidebar-muted-foreground"
          >
            {day}
          </span>
        ))}
        {SAMPLE_WEEK.flatMap((row, r) =>
          row.map((code, d) =>
            code ? (
              <span
                key={`${r}-${d}`}
                dir="ltr"
                className={cn(
                  "inline-flex h-6 items-center justify-center rounded-md text-xs font-bold",
                  SHIFT_PRESENTATION[code].tokenClass,
                )}
              >
                {code}
              </span>
            ) : (
              <span
                key={`${r}-${d}`}
                className="h-6 rounded-md border border-dashed border-sidebar-border"
              />
            ),
          ),
        )}
      </div>
    </div>
  );
}

/**
 * The login page's identity panel, on the same navy surface as the app's
 * navigation. Desktop (lg+): a full-height column beside the form with the
 * product, what it is for, a decorative schedule glimpse and the shift
 * codes. Phones: a compact band
 * above the form (mark, name, one line), so the form stays near the top.
 * Not a landing page: no links, no calls to action; the decoration is
 * `aria-hidden` and the text is plain paragraphs (the form's `h1` stays
 * the page's only heading).
 */
export function LoginBrandPanel({
  shiftLabels,
}: {
  /** Descriptive shift names (`shift_types.label`). */
  shiftLabels: ShiftLabels | null;
}) {
  return (
    <div className="relative isolate overflow-hidden text-sidebar-foreground bg-brand-panel">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-brand-dots mask-b-from-20% lg:mask-b-from-50%"
      />
      <Hospital
        aria-hidden="true"
        strokeWidth={1}
        className="absolute -end-10 -bottom-12 -z-10 size-72 text-sidebar-foreground/[0.06] max-lg:hidden [@media(min-height:37.5rem)]:hidden"
      />
      <span
        aria-hidden="true"
        className="absolute -end-24 -bottom-24 -z-10 size-96 rounded-full border border-sidebar-foreground/[0.07] max-lg:hidden"
      />
      <span
        aria-hidden="true"
        className="absolute -end-10 -bottom-10 -z-10 size-64 rounded-full border border-sidebar-foreground/[0.07] max-lg:hidden"
      />

      <div className="flex flex-col gap-3 px-6 pt-8 pb-16 max-lg:items-center max-lg:text-center sm:pt-10 lg:h-full lg:justify-between lg:gap-8 lg:px-12 lg:py-10 xl:px-16 [@media(min-height:50rem)]:lg:py-16">
        <div className="flex items-center gap-3">
          <BrandMark className="size-11 lg:size-12" />
          <div className="flex flex-col text-start">
            <p className="text-lg leading-snug font-bold lg:text-xl">
              {PRODUCT_NAME}
            </p>
            <p className="text-xs text-sidebar-muted-foreground lg:text-sm">
              ویژه کادر پرستاری بیمارستان
            </p>
          </div>
        </div>

        <div className="flex max-w-md flex-col gap-6 max-lg:hidden">
          <p className="text-3xl leading-snug font-bold text-balance xl:text-[2rem]">
            سامانه برنامه‌ریزی و تأیید شیفت ماهانه پرستاران
          </p>
          <ul className="flex flex-col gap-3.5">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm">
                <span
                  aria-hidden="true"
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-sidebar-border bg-sidebar-accent/70 text-sidebar-ring"
                >
                  <Icon className="size-[1.125rem]" />
                </span>
                <span className="leading-relaxed text-sidebar-foreground/90">
                  {text}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-sm leading-relaxed text-sidebar-muted-foreground lg:hidden">
          سامانه برنامه‌ریزی و تأیید شیفت ماهانه پرستاران
        </p>

        <div className="flex max-w-md flex-col gap-2.5 max-lg:hidden">
          <SchedulePreview />
          <ul aria-label="انواع شیفت" className="flex flex-wrap gap-2">
            {shiftLabels &&
              SHIFT_CODES.map((code) => {
                const shift = SHIFT_PRESENTATION[code];
                return (
                  <li
                    key={code}
                    className="inline-flex items-center gap-2 rounded-full border border-sidebar-border bg-sidebar-accent/60 py-1 ps-1 pe-3 text-xs"
                  >
                    <span
                      dir="ltr"
                      className={cn(
                        "inline-flex h-6 min-w-8 items-center justify-center rounded-full px-1.5 font-bold",
                        shift.tokenClass,
                      )}
                    >
                      {code}
                    </span>
                    {shiftLabels[code]}
                  </li>
                );
              })}
          </ul>
        </div>
      </div>
    </div>
  );
}
