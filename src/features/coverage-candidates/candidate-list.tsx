import type { ReactNode } from "react";
import type {
  AvailableCandidateView,
  CoverageCandidates,
  NotAllowedCandidateView,
} from "@/application/schedules/coverage-candidates";
import { FindingItem } from "@/features/schedule-review/finding-item";
import type { ShiftLabels } from "@/features/shifts/catalog";
import {
  candidateDayLabel,
  candidatePreferenceLabel,
  candidateCompletionMessage,
} from "./presentation";

function Person({
  person,
  shiftLabels,
}: {
  person: AvailableCandidateView | NotAllowedCandidateView;
  shiftLabels: ShiftLabels;
}) {
  return (
    <>
      <p className="font-semibold break-words">{person.displayName}</p>
      {person.personnelNumber && (
        <p className="text-sm break-words">
          شماره پرسنلی: <bdi>{person.personnelNumber}</bdi>
        </p>
      )}
      <p className="text-sm">{candidateDayLabel[person.dayStatus]}</p>
      <p className="text-sm">
        {candidatePreferenceLabel(person.preference, shiftLabels)}
      </p>
    </>
  );
}

/** Map directly: backend order is the D111 order; identities are never printed as ids. */
export function CandidateList({
  data,
  assignControl,
  shiftLabels,
}: {
  data: CoverageCandidates;
  assignControl?: (person: AvailableCandidateView) => ReactNode;
  shiftLabels: ShiftLabels;
}) {
  if (data.status === "NO_SHORTAGE")
    return (
      <p role="status">{candidateCompletionMessage(data.shift, shiftLabels)}</p>
    );
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section aria-label="قابل انتخاب" className="flex flex-col gap-2">
        <h4 className="font-semibold">قابل انتخاب</h4>
        {data.available.length === 0 ? (
          <p>فرد قابل انتخابی برای این کمبود وجود ندارد.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.available.map((person) => (
              <li
                key={person.userId}
                className="flex min-w-0 flex-col gap-1 rounded-lg border p-3"
              >
                <Person person={person} shiftLabels={shiftLabels} />
                {data.canAssign && assignControl?.(person)}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="غیرمجاز" className="flex flex-col gap-2">
        <h4 className="font-semibold">غیرمجاز</h4>
        {data.notAllowed.length > 0 && (
          <p className="text-xs text-muted-foreground">
            دلایل زیر نتیجه بررسی تخصیص فرضی این شیفت هستند.
          </p>
        )}
        {data.notAllowed.length === 0 ? (
          <p>فرد غیرمجازی در این فهرست وجود ندارد.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.notAllowed.map((person) => (
              <li
                key={person.userId}
                className="flex min-w-0 flex-col gap-2 rounded-lg border p-3"
              >
                <Person person={person} shiftLabels={shiftLabels} />
                <ul className="flex flex-col gap-2">
                  {person.findings.map((finding, i) => (
                    <FindingItem
                      key={i}
                      finding={finding}
                      linked={false}
                      shiftLabels={shiftLabels}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
