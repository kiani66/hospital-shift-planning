import type { IsoDate } from "../../domain/shared/dates";

/** Resolve an unambiguous catalog wall time (07/14/19) in an IANA timezone. */
export function zonedInstantAt(timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return (date: IsoDate, time: string): number => {
    const wall = Date.parse(`${date}T${time}:00Z`);
    let instant = wall;
    // Re-evaluate the offset at the candidate instant, including DST boundaries.
    for (let i = 0; i < 3; i++) {
      const parts = Object.fromEntries(
        formatter.formatToParts(instant).map((p) => [p.type, p.value]),
      );
      const represented = Date.parse(
        `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
      );
      if (represented === wall) break;
      instant += wall - represented;
    }
    return instant;
  };
}
