"use client";

import { useId, useState, useTransition } from "react";
import type { DayReview } from "@/application/schedules/review";
import { Button } from "@/components/ui/button";
import { COVERAGE_PERIOD_NAMES } from "@/features/shifts/catalog";
import {
  readCoverageCandidatesAction,
  type CandidateReadResult,
} from "./actions";
import { CandidateList } from "./candidate-list";
import { candidateQueryError } from "./presentation";

/** Each period owns its request; switching day/revision remounts the panel. */
function ShortagePeriod({
  scheduleId,
  date,
  shift,
}: {
  scheduleId: string;
  date: string;
  shift: "M" | "E" | "N";
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<CandidateReadResult | null>(null);
  const [pending, startTransition] = useTransition();
  function load() {
    startTransition(async () => {
      try {
        setResult(
          await readCoverageCandidatesAction({ scheduleId, date, shift }),
        );
      } catch {
        setResult({ ok: false, message: candidateQueryError });
      }
    });
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Button
        variant="outline"
        aria-expanded={open}
        aria-controls={id}
        disabled={pending}
        onClick={() => {
          setOpen(!open);
          if (!open) load();
        }}
      >
        افراد برای کمبود {COVERAGE_PERIOD_NAMES[shift]} ({shift})
      </Button>
      <div
        id={id}
        hidden={!open}
        aria-busy={pending}
        className="flex min-w-0 flex-col gap-2"
      >
        {pending ? (
          <p role="status">در حال دریافت افراد…</p>
        ) : (
          result &&
          (result.ok ? (
            <>
              {result.data.status === "SHORTAGE" && (
                <p role="status" className="sr-only">
                  فهرست افراد دریافت شد.
                </p>
              )}
              <CandidateList data={result.data} />
            </>
          ) : (
            <>
              <p role="alert">{result.message}</p>
              <Button variant="outline" onClick={load}>
                تلاش دوباره
              </Button>
            </>
          ))
        )}
      </div>
    </div>
  );
}

export function ShortageCandidates({
  scheduleId,
  date,
  coverage,
}: {
  scheduleId: string;
  date: string;
  coverage: DayReview["coverage"];
}) {
  const shortages = coverage.filter((c) => c.status === "BELOW_MINIMUM");
  if (!shortages.length) return null;
  return (
    <section
      aria-label="افراد برای جبران کمبود"
      className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-3"
    >
      <h3 className="text-sm font-semibold">افراد برای جبران کمبود</h3>
      <p className="text-xs text-muted-foreground">
        فقط مشاهده؛ تخصیص شیفت از این فهرست هنوز فعال نیست.
      </p>
      {shortages.map((c) => (
        <ShortagePeriod
          key={c.period}
          scheduleId={scheduleId}
          date={date}
          shift={c.period}
        />
      ))}
    </section>
  );
}
