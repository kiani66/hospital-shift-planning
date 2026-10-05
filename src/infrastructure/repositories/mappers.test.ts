import { describe, expect, it } from "vitest";
import { asAssignmentCode, asShiftCode } from "./mappers";

describe("checked decision mapping", () => {
  it("keeps OFF separate from working shifts", () => {
    expect(asAssignmentCode("OFF")).toBe("OFF");
    expect(asShiftCode("ME")).toBe("ME");
    expect(() => asShiftCode("OFF")).toThrow("Unknown working shift code");
  });
  it("fails explicitly for unknown database codes", () => {
    expect(() => asAssignmentCode("REST")).toThrow("Unknown assignment code");
    expect(() => asShiftCode("REST")).toThrow("Unknown working shift code");
  });
});
