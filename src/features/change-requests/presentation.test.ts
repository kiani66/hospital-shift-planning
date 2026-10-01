import { describe, expect, it } from "vitest";

import type { ActionError } from "@/application/result";
import {
  CHANGE_REQUEST_STATUSES,
  CHANGE_REQUEST_TYPES,
  SWAP_CONSENT_STATUSES,
} from "@/domain/change-requests/model";

import {
  CONSENT_STATUS,
  fieldMessages,
  REQUEST_STATUS,
  REQUEST_TYPE_DESCRIPTIONS,
  REQUEST_TYPE_LABELS,
  requestErrorMessage,
  requestSummary,
} from "./presentation";

const PERSIAN = /^[؀-ۿ«]/;
const RAW = /[A-Z]{3,}_|\d{4}-\d{2}-\d{2}/;

const people = {
  requester: { displayName: "سارا نمونه" },
  counterpart: { displayName: "زهرا نمونه" },
};

describe("labels", () => {
  it("words every type, status and consent state in Persian, with a tone", () => {
    for (const type of CHANGE_REQUEST_TYPES) {
      expect(REQUEST_TYPE_LABELS[type]).toMatch(PERSIAN);
      expect(REQUEST_TYPE_DESCRIPTIONS[type]).toMatch(PERSIAN);
    }
    for (const status of CHANGE_REQUEST_STATUSES)
      expect(REQUEST_STATUS[status].label).toMatch(PERSIAN);
    for (const consent of SWAP_CONSENT_STATUSES)
      expect(CONSENT_STATUS[consent].label).toMatch(PERSIAN);
    // Only an applied request is green; a rejected one is never "success".
    expect(REQUEST_STATUS.APPLIED.tone).toBe("success");
    expect(REQUEST_STATUS.REJECTED.tone).not.toBe("success");
  });
});

describe("requestSummary", () => {
  const base = {
    ...people,
    requesterShift: "M" as const,
    targetShift: null,
    counterpartShift: null,
  };

  it.each([
    ["UNAVAILABLE", {}, "امکان حضور در شیفت صبح را ندارد."],
    ["CHANGE_SHIFT", { targetShift: "N" }, "شیفت صبح به شیفت شب تغییر کند."],
    [
      "SWAP",
      { counterpartShift: "E" },
      "شیفت صبح با شیفت عصر «زهرا نمونه» جابه‌جا شود.",
    ],
    [
      "SWAP",
      { counterpartShift: null },
      "شیفت صبح با استراحت «زهرا نمونه» جابه‌جا شود.",
    ],
    ["OTHER", {}, "درباره شیفت صبح؛ جزئیات در توضیح آمده است."],
  ] as const)("words %s", (type, extra, text) => {
    expect(requestSummary({ ...base, ...extra, type })).toBe(text);
  });

  it("speaks to the swap partner from their side", () => {
    expect(
      requestSummary({
        ...base,
        type: "SWAP",
        counterpartShift: "E",
        role: "COUNTERPART",
      }),
    ).toBe(
      "«سارا نمونه» می‌خواهد شیفت صبح خود را با شیفت عصر شما جابه‌جا کند.",
    );
  });
});

describe("errors", () => {
  const error = (overrides: Partial<ActionError>): ActionError => ({
    code: "INTERNAL",
    message: "x",
    ...overrides,
  });

  it.each<[Partial<ActionError>, RegExp]>([
    [
      { code: "CONFLICT", reason: "DUPLICATE_ACTIVE_REQUEST" },
      /درخواست فعال دارید/,
    ],
    [{ code: "CONFLICT" }, /تغییر کرده است/],
    [{ code: "FORBIDDEN", reason: "SCHEDULE_NOT_YET_FINALIZED" }, /ترجیحات/],
    [{ code: "FORBIDDEN", reason: "NOT_MEMBER_OF_DEPARTMENT" }, /عضو فعلی/],
    [{ code: "FORBIDDEN", reason: "SOMETHING_NEW" }, /اجازه/],
    [{ code: "INVALID_STATE", reason: "SWAP_CONTEXT_CHANGED" }, /به‌روز کند/],
    [{ code: "INVALID_STATE", reason: "CANCEL" }, /دیگر در انتظار نیست/],
    [{ code: "VALIDATION", fieldErrors: { note: ["x"] } }, /اصلاح کنید/],
    [{ code: "VALIDATION" }, /معتبر نیست/],
    [{ code: "NOT_FOUND" }, /درخواست پیدا نشد/],
    [{ code: "INTERNAL" }, /دوباره تلاش کنید/],
    [{ code: "RULE_VIOLATION" }, /دوباره تلاش کنید/],
  ])("words %j without codes", (overrides, text) => {
    const message = requestErrorMessage("cancel", error(overrides));
    expect(message).toMatch(text);
    expect(message).not.toMatch(RAW);
  });

  it("names a missing schedule when creating", () => {
    expect(requestErrorMessage("create", error({ code: "NOT_FOUND" }))).toMatch(
      /برنامه/,
    );
  });

  it("maps server field errors to Persian field messages", () => {
    expect(
      fieldMessages(
        error({
          code: "VALIDATION",
          fieldErrors: { note: ["Required"], reasonCode: ["x"], other: ["x"] },
        }),
      ),
    ).toEqual({
      note: expect.stringMatching(/توضیح لازم است/),
      reasonCode: expect.stringMatching(/علت/),
      other: "این مقدار معتبر نیست.",
    });
    expect(fieldMessages(error({}))).toEqual({});
  });
});
