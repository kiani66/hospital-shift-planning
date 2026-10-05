import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ShiftChip } from "./shift-chip";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("ShiftChip", () => {
  it("shows a working shift's code (left-to-right), its color and, on request, its name and icon", () => {
    const html = renderToStaticMarkup(
      createElement(ShiftChip, { code: "N", label: true, icon: true }),
    );
    expect(text(html)).toBe("N شب");
    expect(html).toContain('dir="ltr"');
    expect(html).toContain("bg-shift-n");
    expect(html).toContain('aria-hidden="true"');
  });

  it("shows OFF as «استراحت» on a neutral surface, never the code or a shift color", () => {
    for (const label of [false, true]) {
      const html = renderToStaticMarkup(
        createElement(ShiftChip, { code: "OFF", label, icon: true }),
      );
      expect(text(html)).toBe("استراحت");
      expect(html).toContain("bg-muted");
      expect(html).not.toMatch(/shift-off|bg-shift-/);
    }
  });

  it("adds no icon unless asked", () => {
    const html = renderToStaticMarkup(createElement(ShiftChip, { code: "M" }));
    expect(html).not.toContain("<svg");
    expect(text(html)).toBe("M");
  });
});
