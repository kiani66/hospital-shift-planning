import { expect, it } from "vitest";

import { MEMBERSHIP_LABELS, RELATION_LABELS } from "./presentation";

it("provides distinct Persian relation statuses and membership roles", () => {
  expect(RELATION_LABELS).toEqual({
    CURRENT: "جاری",
    FUTURE: "آینده",
    ENDED: "پایان‌یافته",
  });
  expect(MEMBERSHIP_LABELS).toEqual({
    NURSE: "پرستار",
    HEAD_NURSE: "سرپرستار",
  });
});
