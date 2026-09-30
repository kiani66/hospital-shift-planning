import { BadgeCheck } from "lucide-react";
import { describe, expect, it } from "vitest";

import { SCHEDULE_STATUSES } from "@/domain/schedule/status";

import {
  PREFERENCE_STATE_PRESENTATION,
  SCHEDULE_STATUS_PRESENTATION,
} from "./status-presentation";

describe("schedule status presentation", () => {
  it("gives every status its own icon shape and a Persian label", () => {
    const icons = SCHEDULE_STATUSES.map(
      (s) => SCHEDULE_STATUS_PRESENTATION[s].icon,
    );
    expect(new Set(icons).size).toBe(SCHEDULE_STATUSES.length);
    for (const s of SCHEDULE_STATUSES)
      expect(SCHEDULE_STATUS_PRESENTATION[s].label).toMatch(/^[؀-ۿ]/);
  });

  it("uses a check (and the valid tone) only for APPROVED", () => {
    for (const s of SCHEDULE_STATUSES) {
      const p = SCHEDULE_STATUS_PRESENTATION[s];
      expect(p.icon === BadgeCheck, s).toBe(s === "APPROVED");
      expect(p.tone === "valid", s).toBe(s === "APPROVED");
    }
  });

  it("does not color an open preference window as 'valid'", () => {
    expect(PREFERENCE_STATE_PRESENTATION.OPEN.tone).toBe("active");
    expect(PREFERENCE_STATE_PRESENTATION.OPEN.label).toBe("باز");
  });
});
