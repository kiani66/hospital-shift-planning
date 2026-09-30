"use client";

import {
  CalendarRange,
  Check,
  CircleAlert,
  Eraser,
  Keyboard,
  LoaderCircle,
  Search,
  Undo2,
} from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";

import { Badge } from "@/components/ui/badge";
import type { MembershipRole } from "@/domain/authz/actor";
import { preferenceFit } from "@/domain/preferences/preference-fit";
import {
  revertChanges,
  type AssignmentChange,
  type AssignmentEdit,
} from "@/domain/schedule/assignment-editing";
import type { IsoDate } from "@/domain/shared/dates";
import {
  SHIFT_CODES,
  type PreferenceValue,
  type ShiftCode,
} from "@/domain/shifts/shift-type";
import { faNumber } from "@/features/calendar/jalali";
import { ROLE_LABELS } from "@/features/schedule/labels";
import { preferenceLabel } from "@/features/schedule-review/presentation";
import { SHIFT_PRESENTATION } from "@/features/shifts/catalog";
import { cn } from "@/lib/utils";

import type { DayOption } from "./range-form";
import { setAssignmentsAction, type AssignmentEditResult } from "./actions";
import {
  NETWORK_FAILURE,
  nurseRowId,
  preferenceFitLabel,
  savedMessage,
  type EditFailureKind,
} from "./presentation";
import { RangeForm } from "./range-form";
import { editorKeyCommand, SHORTCUT_HELP } from "./shortcuts";

/** A rostered nurse on the edited day (server data; `shift` is the stored one). */
export interface EditorNurse {
  readonly userId: string;
  readonly displayName: string;
  readonly role: MembershipRole;
  readonly shift: ShiftCode | null;
  readonly preference: PreferenceValue | null;
  /** Involved in a finding on this day (or one involving it). */
  readonly flagged: boolean;
}

export type { DayOption } from "./range-form";

type Filter = "ALL" | "UNASSIGNED" | ShiftCode;

/** A nurse's controls in reading order: the four shifts, "no shift", the range form. */
const COLUMNS = [...SHIFT_CODES, null, "RANGE"] as const;
const LAST_COLUMN = COLUMNS.length - 1;

type Status =
  | {
      readonly kind: "saved";
      readonly message: string;
      /** What the last successful request changed (undo restores it). */
      readonly undo: readonly AssignmentChange[] | null;
    }
  | {
      readonly kind: "error";
      readonly failure: EditFailureKind;
      readonly message: string;
      /** Edits queued behind the failed one that were therefore not sent. */
      readonly skipped: number;
    };

const focusRing =
  "focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none";

/** Arabic ي/ك typed on some keyboards match Persian ی/ک in names. */
const normalize = (text: string) =>
  text.replace(/ي/g, "ی").replace(/ك/g, "ک").trim();

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  return (
    target instanceof HTMLInputElement &&
    !["button", "checkbox", "radio", "submit", "reset"].includes(target.type)
  );
}

/**
 * The Head Nurse's editor for one day: every rostered nurse (assigned or
 * not, in a stable order) with their shift, preference and findings, and
 * one-step controls to set M / E / N / ME or clear the shift. Clearing
 * leaves the nurse in the list, available again.
 *
 * Saving: each click or shortcut is one request to the `setAssignments` use
 * case. Requests are sent one at a time, each with the latest schedule
 * revision, so fast keyboard entry never conflicts with itself. The choice
 * shows at once as pending (optimistic) and is replaced by the server's
 * state when the page re-renders; a refused request falls back to it and
 * says why, and the requests queued behind it are not sent (nothing is
 * applied on top of a state the user has not seen). Validation is never
 * done here: findings come from the server's re-validation of the schedule.
 *
 * Undo re-sends the replaced values of the last saved request through the
 * same use case (authorization, revision check and audit included).
 */
export function DayEditor({
  scheduleId,
  revision,
  date,
  dayLabel,
  nurses,
  rangeEnds,
  previousDayHref,
  nextDayHref,
}: {
  scheduleId: string;
  /** The schedule revision the page was rendered with. */
  revision: number;
  date: IsoDate;
  /** "شنبه ۲ آبان ۱۴۰۵" */
  dayLabel: string;
  nurses: readonly EditorNurse[];
  /** The later days of the period, for range edits (label = Jalali date). */
  rangeEnds: readonly DayOption[];
  previousDayHref: Route | null;
  nextDayHref: Route | null;
}) {
  const router = useRouter();
  const ids = { list: useId(), search: useId(), status: useId() };

  // --- Server state + optimistic edits -----------------------------------
  const stored = useMemo(
    () => new Map(nurses.map((n) => [n.userId, n.shift])),
    [nurses],
  );
  const [shifts, addEdits] = useOptimistic(
    stored,
    (state, edits: readonly AssignmentEdit[]) => {
      const next = new Map(state);
      for (const e of edits) if (e.date === date) next.set(e.nurseId, e.shift);
      return next;
    },
  );
  const [pendingIds, addPending] = useOptimistic(
    new Set<string>(),
    (state, nurseIds: readonly string[]) => new Set([...state, ...nurseIds]),
  );
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status | null>(null);

  // --- The request queue --------------------------------------------------
  const revisionRef = useRef(revision);
  useEffect(() => {
    // The page re-rendered from the server (after an edit, a conflict or a navigation).
    revisionRef.current = Math.max(revisionRef.current, revision);
  }, [revision]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  /** Bumped by a failure: requests queued before it are dropped. */
  const epoch = useRef(0);

  const names = useMemo(
    () => new Map(nurses.map((n) => [n.userId, n.displayName])),
    [nurses],
  );
  const labels = useMemo(
    () =>
      new Map<string, string>([
        [date, dayLabel],
        ...rangeEnds.map((d) => [d.date, d.label] as const),
      ]),
    [date, dayLabel, rangeEnds],
  );

  function submit(edits: AssignmentEdit[], undo = false) {
    const ticket = epoch.current;
    startTransition(async () => {
      addEdits(edits);
      addPending(edits.filter((e) => e.date === date).map((e) => e.nurseId));
      const run = queue.current.then(async () => {
        if (epoch.current !== ticket) {
          setStatus((s) =>
            s?.kind === "error" ? { ...s, skipped: s.skipped + 1 } : s,
          );
          return;
        }
        let result: AssignmentEditResult;
        try {
          result = await setAssignmentsAction({
            scheduleId,
            expectedRevision: revisionRef.current,
            changes: edits,
          });
        } catch {
          result = { ok: false, ...NETWORK_FAILURE };
        }
        if (result.ok) {
          revisionRef.current = Math.max(revisionRef.current, result.revision);
          setStatus({
            kind: "saved",
            message: savedMessage(
              result.changes,
              names,
              (d) => labels.get(d) ?? d,
              undo,
            ),
            undo: result.changes.length > 0 ? result.changes : null,
          });
        } else {
          epoch.current += 1;
          setStatus({
            kind: "error",
            failure: result.kind,
            message: result.message,
            skipped: 0,
          });
        }
      });
      queue.current = run.catch(() => {});
      await run;
    });
  }

  function assign(nurseId: string, shift: ShiftCode | null) {
    // Repeating the value on screen (a double click, a repeated key) sends nothing.
    if ((shifts.get(nurseId) ?? null) === shift) return;
    keep(nurseId);
    submit([{ nurseId, date, shift }]);
  }

  function undoLast() {
    if (status?.kind !== "saved" || !status.undo) return;
    submit(revertChanges(status.undo), true);
  }

  // --- Filter, search and rows kept visible while edited --------------------
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const [rangeFor, setRangeFor] = useState<string | null>(null);
  const [shownDate, setShownDate] = useState(date);
  if (shownDate !== date) {
    // Another day: forget per-day UI state (the filter and search stay).
    setShownDate(date);
    setKept(new Set());
    setRangeFor(null);
  }
  const keep = (nurseId: string) =>
    setKept((k) => (k.has(nurseId) ? k : new Set([...k, nurseId])));
  const chooseFilter = (next: Filter) => {
    setFilter(next);
    setKept(new Set());
  };

  const matches = (f: Filter, shift: ShiftCode | null) =>
    f === "ALL" || (f === "UNASSIGNED" ? shift === null : shift === f);
  const needle = normalize(query);
  const visible = nurses.filter(
    (n) =>
      (kept.has(n.userId) || matches(filter, shifts.get(n.userId) ?? null)) &&
      (needle === "" || normalize(n.displayName).includes(needle)),
  );
  const count = (f: Filter) =>
    nurses.filter((n) => matches(f, shifts.get(n.userId) ?? null)).length;

  // --- Roving focus: the list is one tab stop; arrows move within it --------
  const [active, setActive] = useState<{ id: string; col: number } | null>(
    null,
  );
  const cells = useRef(new Map<string, HTMLButtonElement>());
  const tabStop =
    active && visible.some((n) => n.userId === active.id)
      ? active
      : visible[0]
        ? { id: visible[0].userId, col: 0 }
        : null;
  const focusCell = (id: string, col: number) => {
    setActive({ id, col });
    cells.current.get(`${id}:${col}`)?.focus();
  };
  // After a keyboard day change, focus returns to the same nurse and control
  // (or, when that nurse is not listed for the new day, the list's first one).
  const restoreFocus = useRef<{ id: string; col: number } | null>(null);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const target = restoreFocus.current;
    if (!target) return;
    restoreFocus.current = null;
    const cell =
      cells.current.get(`${target.id}:${target.col}`) ??
      root.current?.querySelector<HTMLElement>(
        `[data-cell][data-col="${target.col}"]`,
      );
    cell?.focus();
  }, [date]);
  const registerCell = (key: string, el: HTMLButtonElement | null) => {
    if (el) cells.current.set(key, el);
    else cells.current.delete(key);
  };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (isTextEntry(event.target)) return;
    const command = editorKeyCommand(event);
    if (!command) return;

    if (command.type === "DAY") {
      const href = command.direction === "next" ? nextDayHref : previousDayHref;
      if (href) {
        event.preventDefault();
        restoreFocus.current = active ?? tabStop;
        router.replace(href, { scroll: false });
      }
      return;
    }
    if (command.type === "UNDO") {
      if (status?.kind === "saved" && status.undo) {
        event.preventDefault();
        undoLast();
      }
      return;
    }

    // The rest act on the nurse whose control has focus, and nowhere else.
    const cell = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-cell]",
    );
    if (!cell) return;
    const id = cell.dataset.nurseId!;
    const col = Number(cell.dataset.col);
    event.preventDefault();
    switch (command.type) {
      case "SET":
        return assign(id, command.shift);
      case "CLEAR":
        return assign(id, null);
      case "ROW": {
        const index = visible.findIndex((n) => n.userId === id);
        const target = visible[index + command.delta];
        if (target) focusCell(target.userId, col);
        return;
      }
      case "COLUMN":
        return focusCell(
          id,
          Math.min(LAST_COLUMN, Math.max(0, col + command.delta)),
        );
    }
  }

  const filters: readonly { value: Filter; label: string; dot?: string }[] = [
    { value: "ALL", label: "همه" },
    { value: "UNASSIGNED", label: "بدون شیفت" },
    ...SHIFT_CODES.map((code) => ({
      value: code,
      label: `${SHIFT_PRESENTATION[code].name} (${code})`,
      dot: SHIFT_PRESENTATION[code].dotClass,
    })),
  ];

  return (
    <section
      ref={root}
      aria-labelledby={`${ids.list}-heading`}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${ids.list}-heading`} className="font-semibold">
          شیفت‌های پرسنل در این روز
          <span className="ms-2 text-sm font-normal text-muted-foreground tabular-nums">
            ({faNumber(nurses.length)} نفر)
          </span>
        </h3>
        <details className="text-sm max-sm:hidden">
          <summary
            className={cn(
              "inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md px-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground pointer-coarse:min-h-11",
              focusRing,
            )}
          >
            <Keyboard aria-hidden="true" className="size-4" />
            میان‌برهای صفحه‌کلید
          </summary>
          <div className="mt-2 rounded-lg border bg-background p-3 shadow-sm">
            <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
              وقتی یکی از دکمه‌های شیفت یک پرستار انتخاب (فوکوس) شده است:
            </p>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
              {SHORTCUT_HELP.map((s) => (
                <div key={s.keys} className="contents">
                  <dt dir="ltr" className="text-end font-mono font-semibold">
                    {s.keys}
                  </dt>
                  <dd>{s.action}</dd>
                </div>
              ))}
            </dl>
          </div>
        </details>
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div
          role="group"
          aria-label="نمایش پرسنل"
          className="-mx-1 flex [scrollbar-width:none] gap-1 overflow-x-auto px-1 pb-0.5 md:flex-wrap md:overflow-visible"
        >
          {filters.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => chooseFilter(f.value)}
              className={cn(
                "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs whitespace-nowrap pointer-coarse:min-h-11",
                focusRing,
                filter === f.value
                  ? "border-primary bg-primary text-primary-foreground shadow-xs"
                  : "border-input bg-background hover:border-primary/35 hover:bg-accent",
              )}
            >
              {f.dot && (
                <span
                  aria-hidden="true"
                  className={cn("size-2 rounded-full", f.dot)}
                />
              )}
              {f.label}
              <span className="font-semibold tabular-nums">
                {faNumber(count(f.value))}
              </span>
            </button>
          ))}
        </div>
        <label className="relative md:ms-auto md:w-56 md:shrink-0">
          <span className="sr-only">جستجوی نام</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            id={ids.search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جستجوی نام…"
            className="min-h-9 w-full rounded-md border border-input bg-background ps-8 pe-2 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none pointer-coarse:min-h-11 pointer-coarse:text-base"
          />
        </label>
      </div>

      <EditStatus
        id={ids.status}
        pending={pending}
        status={status}
        onUndo={undoLast}
      />

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/50 p-4 text-center text-sm text-muted-foreground">
          {nurses.length === 0
            ? "فهرست پرسنل این برنامه خالی است."
            : "هیچ پرستاری با این فیلتر یا جستجو پیدا نشد."}
        </p>
      ) : (
        <ul
          id={ids.list}
          aria-label="پرسنل برنامه در این روز"
          aria-describedby={ids.status}
          aria-busy={pending || undefined}
          className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs"
        >
          {visible.map((n) => (
            <NurseRow
              key={n.userId}
              nurse={n}
              shift={shifts.get(n.userId) ?? null}
              pending={pendingIds.has(n.userId)}
              tabCol={tabStop?.id === n.userId ? tabStop.col : null}
              rangeOpen={rangeFor === n.userId}
              rangeEnds={rangeEnds}
              registerCell={registerCell}
              onFocusCell={(col) => setActive({ id: n.userId, col })}
              onAssign={(shift) => assign(n.userId, shift)}
              onToggleRange={() =>
                setRangeFor((r) => (r === n.userId ? null : n.userId))
              }
              onApplyRange={(shift, dates) => {
                keep(n.userId);
                setRangeFor(null);
                submit(
                  dates.map((d) => ({ nurseId: n.userId, date: d, shift })),
                );
                cells.current.get(`${n.userId}:${LAST_COLUMN}`)?.focus();
              }}
              date={date}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function EditStatus({
  id,
  pending,
  status,
  onUndo,
}: {
  id: string;
  pending: boolean;
  status: Status | null;
  onUndo: () => void;
}) {
  return (
    <div id={id} className="-my-1.5 text-sm">
      <div role="status" className="flex flex-wrap items-center gap-2">
        {pending ? (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <LoaderCircle
              aria-hidden="true"
              className="size-4 motion-safe:animate-spin"
            />
            در حال ثبت…
          </span>
        ) : status?.kind === "saved" ? (
          <>
            <span className="inline-flex items-start gap-1.5">
              <Check
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-status-success-foreground"
              />
              {status.message}
            </span>
            {status.undo && (
              <button
                type="button"
                onClick={onUndo}
                className={cn(
                  "inline-flex min-h-8 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs font-medium text-primary hover:bg-accent pointer-coarse:min-h-11",
                  focusRing,
                )}
              >
                <Undo2
                  aria-hidden="true"
                  className="size-3.5 rtl:-scale-x-100"
                />
                بازگردانی
              </button>
            )}
          </>
        ) : null}
      </div>
      {!pending && status?.kind === "error" && (
        <p
          role="alert"
          data-failure={status.failure}
          className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 leading-relaxed text-destructive"
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            {status.message}
            {status.skipped > 0 &&
              ` ${faNumber(status.skipped)} تغییر بعدی هم ارسال نشد.`}
          </span>
        </p>
      )}
    </div>
  );
}

function NurseRow({
  nurse,
  shift,
  pending,
  tabCol,
  rangeOpen,
  rangeEnds,
  registerCell,
  onFocusCell,
  onAssign,
  onToggleRange,
  onApplyRange,
  date,
}: {
  nurse: EditorNurse;
  /** The shift shown: the stored one or a pending edit. */
  shift: ShiftCode | null;
  pending: boolean;
  /** The column that is the list's tab stop, when it is in this row. */
  tabCol: number | null;
  rangeOpen: boolean;
  rangeEnds: readonly DayOption[];
  registerCell: (key: string, el: HTMLButtonElement | null) => void;
  onFocusCell: (col: number) => void;
  onAssign: (shift: ShiftCode | null) => void;
  onToggleRange: () => void;
  onApplyRange: (shift: ShiftCode | null, dates: IsoDate[]) => void;
  date: IsoDate;
}) {
  const fit = preferenceFit(nurse.preference, shift);
  const fitLabel = preferenceFitLabel(fit);
  const rangeId = useId();
  const cellProps = (col: number) => ({
    ref: (el: HTMLButtonElement | null) => {
      registerCell(`${nurse.userId}:${col}`, el);
    },
    "data-cell": "",
    "data-nurse-id": nurse.userId,
    "data-col": col,
    tabIndex: tabCol === col ? 0 : -1,
    onFocus: () => onFocusCell(col),
  });
  const control = cn(
    "inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-md border px-1 text-sm font-bold transition-colors max-sm:flex-1 md:h-8 md:min-w-8 pointer-coarse:h-11 pointer-coarse:min-w-11",
    focusRing,
  );

  return (
    <li
      id={nurseRowId(nurse.userId)}
      data-nurse-row={nurse.userId}
      data-shift={shift ?? "NONE"}
      data-pending={pending || undefined}
      data-flagged={nurse.flagged || undefined}
      className={cn(
        "scroll-mt-40 border-s-3 px-3 py-2 transition-colors target:bg-brand-soft",
        nurse.flagged
          ? "border-s-health-attention bg-health-attention/8 focus-within:bg-health-attention/14"
          : "border-s-transparent focus-within:border-s-primary focus-within:bg-brand-soft/60 hover:bg-muted/50",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-44 flex-col gap-0.5">
          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="truncate text-sm font-medium">
              {nurse.displayName}
            </span>
            {nurse.role === "HEAD_NURSE" && (
              <Badge tone="brand-soft" size="sm">
                {ROLE_LABELS.HEAD_NURSE}
              </Badge>
            )}
            {nurse.flagged && (
              <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-health-attention-foreground">
                <CircleAlert aria-hidden="true" className="size-3.5" />
                نیاز به بررسی
              </span>
            )}
            {pending && (
              <LoaderCircle
                role="img"
                aria-label="در حال ثبت"
                className="size-3.5 shrink-0 text-muted-foreground motion-safe:animate-spin"
              />
            )}
          </p>
          {nurse.preference && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span className="rounded border border-primary/15 bg-brand-soft/70 px-1.5 text-brand-soft-foreground">
                {preferenceLabel(nurse.preference)}
              </span>
              {fitLabel && (
                <span
                  data-fit={fit}
                  className={cn(
                    "font-medium",
                    fit === "MATCHES"
                      ? "text-status-success-foreground"
                      : "text-status-warning-foreground",
                  )}
                >
                  <span aria-hidden="true">
                    {fit === "DIFFERS" ? "≠ " : "✓ "}
                  </span>
                  {fitLabel}
                </span>
              )}
            </p>
          )}
        </div>

        <div
          role="group"
          aria-label={`شیفت ${nurse.displayName}`}
          className="flex items-center gap-1 max-sm:w-full"
        >
          {SHIFT_CODES.map((code, col) => {
            const selected = shift === code;
            return (
              <button
                key={code}
                type="button"
                {...cellProps(col)}
                aria-pressed={selected}
                aria-label={`${SHIFT_PRESENTATION[code].name} (${code})`}
                onClick={() => onAssign(code)}
                className={cn(
                  control,
                  selected
                    ? cn(
                        SHIFT_PRESENTATION[code].tokenClass,
                        "border-current shadow-sm ring-1 ring-current/25",
                      )
                    : "border-input bg-background text-muted-foreground hover:border-primary/35 hover:bg-accent hover:text-accent-foreground",
                  selected && pending && "opacity-70",
                )}
              >
                <span dir="ltr">{code}</span>
              </button>
            );
          })}
          <button
            type="button"
            {...cellProps(SHIFT_CODES.length)}
            aria-pressed={shift === null}
            aria-label="بدون شیفت"
            onClick={() => onAssign(null)}
            className={cn(
              control,
              shift === null
                ? "border-dashed border-muted-foreground bg-muted text-foreground shadow-sm"
                : "border-input bg-background text-muted-foreground hover:border-primary/35 hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Eraser aria-hidden="true" className="size-4" />
          </button>
          <button
            type="button"
            {...cellProps(LAST_COLUMN)}
            aria-expanded={rangeOpen}
            aria-controls={rangeId}
            aria-label={`چند روز برای ${nurse.displayName}`}
            disabled={rangeEnds.length === 0}
            onClick={onToggleRange}
            className={cn(
              control,
              "ms-1 border-input bg-background text-muted-foreground hover:border-primary/35 hover:bg-accent hover:text-accent-foreground disabled:border-dashed disabled:bg-muted disabled:opacity-60 disabled:hover:bg-muted",
              rangeOpen && "border-primary bg-brand-soft text-primary",
            )}
          >
            <CalendarRange aria-hidden="true" className="size-4" />
          </button>
        </div>
      </div>
      {rangeOpen && (
        <RangeForm
          id={rangeId}
          nurseName={nurse.displayName}
          initialShift={shift}
          date={date}
          rangeEnds={rangeEnds}
          onApply={onApplyRange}
          onCancel={onToggleRange}
        />
      )}
    </li>
  );
}
