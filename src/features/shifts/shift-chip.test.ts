import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ASSIGNMENT_CODES } from "@/domain/shifts/shift-type";

import { SHIFT_LABELS } from "../../../tests/support/shift-labels";

import { ShiftChip } from "./shift-chip";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("ShiftChip", () => {
  it("shows a working shift's code (left-to-right), its color and, on request, its label and icon", () => {
    const html = renderToStaticMarkup(
      createElement(ShiftChip, {
        code: "N",
        label: SHIFT_LABELS.N,
        icon: true,
      }),
    );
    expect(text(html)).toBe("N شب");
    expect(html).toContain('dir="ltr"');
    expect(html).toContain("bg-shift-n");
    expect(html).toContain('aria-hidden="true"');
  });

  it("shows every code as its code, OFF included", () => {
    for (const code of ASSIGNMENT_CODES) {
      const html = renderToStaticMarkup(createElement(ShiftChip, { code }));
      expect(text(html)).toBe(code);
      expect(html).toContain(`<span dir="ltr">${code}</span>`);
    }
  });

  it("shows OFF as the code «OFF» on a neutral surface, with its label only when given", () => {
    const bare = renderToStaticMarkup(
      createElement(ShiftChip, { code: "OFF", icon: true }),
    );
    expect(text(bare)).toBe("OFF");
    expect(bare).not.toContain("استراحت");
    expect(bare).toContain("bg-muted");
    expect(bare).not.toMatch(/shift-off|bg-shift-/);
    const labelled = renderToStaticMarkup(
      createElement(ShiftChip, { code: "OFF", label: SHIFT_LABELS.OFF }),
    );
    expect(text(labelled)).toBe("OFF استراحت");
  });

  it("adds no icon unless asked", () => {
    const html = renderToStaticMarkup(createElement(ShiftChip, { code: "M" }));
    expect(html).not.toContain("<svg");
    expect(text(html)).toBe("M");
  });
});
