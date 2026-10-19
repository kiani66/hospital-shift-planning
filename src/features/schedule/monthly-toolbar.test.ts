import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MonthlyToolbar } from "./monthly-toolbar";

describe("monthly toolbar composition", () => {
  it("preserves each supplied control once, including disabled descriptions", () => {
    const html = renderToStaticMarkup(
      h(MonthlyToolbar, {
        navigation: h("h1", null, "آبان ۱۴۰۵"),
        primary: h(
          "button",
          { disabled: true, "aria-describedby": "blockers" },
          "نهایی‌سازی برنامه",
        ),
        secondary: h(
          "div",
          null,
          h(
            "button",
            { disabled: true, "aria-describedby": "template-note" },
            "خروجی اکسل",
          ),
          h("p", { id: "template-note" }, "قالب اکسل در دسترس نیست"),
        ),
      }),
    );
    expect(html.match(/نهایی‌سازی برنامه/g)).toHaveLength(1);
    expect(html.match(/خروجی اکسل/g)).toHaveLength(1);
    expect(html).toContain('disabled="" aria-describedby="blockers"');
    expect(html).toContain('disabled="" aria-describedby="template-note"');
    expect(html).toContain('id="template-note"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("does not introduce workflow or secondary actions when none are supplied", () => {
    const html = renderToStaticMarkup(
      h(MonthlyToolbar, {
        navigation: h("h1", null, "آبان ۱۴۰۵"),
      }),
    );
    expect(html).toContain("آبان ۱۴۰۵");
    expect(html).not.toContain("<button");
    expect(html).not.toContain('role="group"');
  });
});
