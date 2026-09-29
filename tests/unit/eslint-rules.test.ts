import { ESLint, RuleTester } from "eslint";
import { describe, expect, it } from "vitest";

import rule, {
  findPhysicalClasses,
} from "../../eslint-rules/no-physical-direction-classes.mjs";

describe("findPhysicalClasses", () => {
  it.each([
    ["ml-4", "ms-4"],
    ["pr-2", "pe-2"],
    ["-mr-1", "-me-1"],
    ["md:pl-6", "ps-6"],
    ["!pl-1", "!ps-1"],
    ["left-0", "start-0"],
    ["right-1/2", "end-1/2"],
    ["text-right", "text-end"],
    ["float-left", "float-start"],
    ["border-l", "border-s"],
    ["border-r-2", "border-e-2"],
    ["rounded-l-md", "rounded-s-md"],
    ["rounded-tr-lg", "rounded-se-lg"],
    ["rounded-bl", "rounded-es"],
    ["scroll-ml-4", "scroll-ms-4"],
  ])("flags %s and suggests %s", (cls, suggestion) => {
    expect(findPhysicalClasses(cls)).toEqual([[cls, suggestion]]);
  });

  it.each([
    "ms-4 pe-2 start-0 end-0 text-start text-end border-s rounded-se-lg",
    "mx-auto px-4 inset-x-0 space-x-2 gap-2 prose",
    "rtl:rotate-180 ltr:ml-2 rtl:text-right",
    "صبح و عصر",
  ])("allows %j", (value) => {
    expect(findPhysicalClasses(value)).toEqual([]);
  });
});

describe("hsp/no-physical-direction-classes", () => {
  const tester = new RuleTester({
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
  });

  it("reports physical classes in JSX and template literals", () => {
    tester.run("no-physical-direction-classes", rule, {
      valid: ['<div className="ms-2 pe-4" />', "const c = `text-start ${x}`;"],
      invalid: [
        {
          code: '<div className="ml-2 pe-4" />',
          errors: [{ messageId: "physical" }],
        },
        { code: "const c = `pl-2 ${x} text-right`;", errors: 2 },
      ],
    });
  });
});

describe("layer boundaries", () => {
  const eslint = new ESLint({ cwd: process.cwd() });
  const errorsFor = async (filePath: string, code: string) => {
    const [result] = await eslint.lintText(code, { filePath });
    return (result?.messages ?? [])
      .filter((m) => m.ruleId === "no-restricted-imports")
      .map((m) => m.message);
  };

  it("keeps domain free of infrastructure and framework imports", async () => {
    const code = [
      'import { getDb } from "@/infrastructure/db/client";',
      'import { sql } from "drizzle-orm";',
      'import { redirect } from "next/navigation";',
      "export const x = [getDb, sql, redirect];",
    ].join("\n");
    expect(await errorsFor("src/domain/example.ts", code)).toHaveLength(3);
  });

  it("blocks relative-path escapes from domain", async () => {
    const code =
      'import { x } from "../infrastructure/db/client";\nexport const y = x;';
    expect(await errorsFor("src/domain/example.ts", code)).toHaveLength(1);
  });

  it("keeps application free of UI and Next.js", async () => {
    const code =
      'import { cookies } from "next/headers";\nexport const x = cookies;';
    expect(await errorsFor("src/application/example.ts", code)).toHaveLength(1);
  });

  it("keeps UI features away from the database", async () => {
    const code =
      'import { getDb } from "@/infrastructure/db/client";\nexport const x = getDb;';
    expect(
      await errorsFor("src/features/example/example.ts", code),
    ).toHaveLength(1);
  });

  it("allows application to use domain and infrastructure", async () => {
    const code = [
      'import { a } from "@/domain/schedule/state-machine";',
      'import { b } from "@/infrastructure/db/client";',
      "export const x = [a, b];",
    ].join("\n");
    expect(await errorsFor("src/application/example.ts", code)).toEqual([]);
  });
}, 60_000);
