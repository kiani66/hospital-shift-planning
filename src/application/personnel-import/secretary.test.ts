import { expect, it } from "vitest";
import { analyzePersonnelCsv } from "./rows";
import { summarizeRoster } from "../schedules/roster-summary";

it.each(["SECRETARY", "منشی"])(
  "imports %s as a secretary, never as a nurse",
  (role) => {
    expect(
      analyzePersonnelCsv(
        `شماره پرسنلی,نام و نام خانوادگی,نقش\n00123,منشی نمونه,${role}`,
      ),
    ).toMatchObject({
      ok: true,
      candidates: [{ person: { personnelNumber: "00123", role: "SECRETARY" } }],
    });
  },
);
it("separates personnel counts", () => {
  expect(
    summarizeRoster([
      { role: "NURSE" },
      { role: "HEAD_NURSE" },
      { role: "SECRETARY" },
    ]),
  ).toEqual({ total: 3, nurses: 1, headNurses: 1, secretaries: 1 });
});
