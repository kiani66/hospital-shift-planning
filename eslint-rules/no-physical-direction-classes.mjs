/**
 * Rejects physical-direction Tailwind utilities (ml-4, pr-2, left-0,
 * text-right, border-l, rounded-tr, ...) in string literals. The UI is RTL
 * (Persian), so layout must use logical utilities (ms-, pe-, start-,
 * text-end, border-s, rounded-se, ...) that follow the document direction.
 *
 * Classes behind an explicit `rtl:` or `ltr:` variant are allowed: those are
 * deliberate direction-specific overrides.
 */

const PHYSICAL = [
  {
    pattern: /^(m|p|scroll-m|scroll-p)([lr])-/,
    fix: (m) => `${m[1]}${m[2] === "l" ? "s" : "e"}-`,
  },
  {
    pattern: /^(left|right)-/,
    fix: (m) => (m[1] === "left" ? "start-" : "end-"),
  },
  {
    pattern: /^border-([lr])(-|$)/,
    fix: (m) => `border-${m[1] === "l" ? "s" : "e"}${m[2]}`,
  },
  {
    pattern: /^rounded-([lr])(-|$)/,
    fix: (m) => `rounded-${m[1] === "l" ? "s" : "e"}${m[2]}`,
  },
  {
    pattern: /^rounded-([tb])([lr])(-|$)/,
    fix: (m) =>
      `rounded-${m[1] === "t" ? "s" : "e"}${m[2] === "l" ? "s" : "e"}${m[3]}`,
  },
  {
    pattern: /^(text|float|clear)-(left|right)$/,
    fix: (m) => `${m[1]}-${m[2] === "left" ? "start" : "end"}`,
  },
];

/** Returns [offendingClass, suggestion] pairs found in a class string. */
export function findPhysicalClasses(value) {
  const found = [];
  for (const token of value.split(/\s+/)) {
    if (!token) continue;
    const parts = token.split(":");
    const variants = parts.slice(0, -1);
    if (variants.includes("rtl") || variants.includes("ltr")) continue;
    const [, modifiers, utility] = parts.at(-1).match(/^(!?-?)(.*)$/);
    for (const { pattern, fix } of PHYSICAL) {
      const match = utility.match(pattern);
      if (match) {
        found.push([token, modifiers + utility.replace(match[0], fix(match))]);
        break;
      }
    }
  }
  return found;
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow physical-direction Tailwind classes in an RTL app",
    },
    messages: {
      physical:
        "'{{cls}}' is a physical-direction class; use the logical '{{suggestion}}' (RTL-safe).",
    },
    schema: [],
  },
  create(context) {
    const check = (node, value) => {
      for (const [cls, suggestion] of findPhysicalClasses(value)) {
        context.report({
          node,
          messageId: "physical",
          data: { cls, suggestion },
        });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};

export default rule;
