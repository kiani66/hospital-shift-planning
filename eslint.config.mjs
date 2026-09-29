import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import noPhysicalDirectionClasses from "./eslint-rules/no-physical-direction-classes.mjs";

/**
 * Layer boundaries (see AGENTS.md):
 *   domain         pure TypeScript; imports nothing from other layers or frameworks
 *   application    use cases; may use domain + infrastructure, never UI or Next.js
 *   infrastructure db/auth/config; may use domain, never application or UI
 *   app/features/components  UI; must reach the database through application
 */
const layer = (name) => [`@/${name}`, `@/${name}/**`, `**/${name}/**`];
const restrict = (patterns, message) => ({
  "no-restricted-imports": [
    "error",
    { patterns: [{ group: patterns, message }] },
  ],
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.ts", "**/*.test.tsx"],
    plugins: {
      hsp: {
        rules: { "no-physical-direction-classes": noPhysicalDirectionClasses },
      },
    },
    rules: { "hsp/no-physical-direction-classes": "error" },
  },
  {
    files: ["src/domain/**/*.ts"],
    rules: restrict(
      [
        ...layer("application"),
        ...layer("infrastructure"),
        ...layer("features"),
        ...layer("components"),
        ...layer("app"),
        "react",
        "react-dom",
        "next",
        "next/**",
        "next-auth",
        "next-auth/**",
        "drizzle-orm",
        "drizzle-orm/**",
        "pg",
        "server-only",
      ],
      "domain/ must stay pure: no framework, database or other-layer imports.",
    ),
  },
  {
    files: ["src/application/**/*.ts"],
    rules: restrict(
      [
        ...layer("features"),
        ...layer("components"),
        ...layer("app"),
        "react",
        "react-dom",
        "next",
        "next/**",
      ],
      "application/ must not depend on UI or Next.js; adapters live in features/ and app/.",
    ),
  },
  {
    files: ["src/infrastructure/**/*.ts"],
    rules: restrict(
      [
        ...layer("application"),
        ...layer("features"),
        ...layer("components"),
        ...layer("app"),
      ],
      "infrastructure/ must not depend on application or UI code.",
    ),
  },
  {
    files: ["src/features/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: restrict(
      [
        "@/infrastructure/db",
        "@/infrastructure/db/**",
        "**/infrastructure/db/**",
        "drizzle-orm",
        "drizzle-orm/**",
        "pg",
      ],
      "UI must reach the database through application use cases/queries.",
    ),
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
