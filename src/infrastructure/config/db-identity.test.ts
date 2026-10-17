import { describe, expect, it } from "vitest";

import {
  DIAGNOSTIC_FAILED_LINE,
  describeDatabaseIdentity,
  endpointIdentity,
  endpointParts,
  parseIdentityLine,
  verifyIdentityLine,
} from "./db-identity";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const DEPLOYMENT = "dpl_TESTDEPLOYMENT";
const PREVIEW_POOLED = "ep-test-preview-aaaa1111-pooler.c-9.example.neon.tech";
const PREVIEW_DIRECT = "ep-test-preview-aaaa1111.c-9.example.neon.tech";
const PROD_POOLED = "ep-test-prod-bbbb2222-pooler.c-9.example.neon.tech";
const PROD_DIRECT = "ep-test-prod-bbbb2222.c-9.example.neon.tech";

// Password and user are unmistakable so leaks are detectable.
const url = (host: string, database = "neondb") =>
  `postgresql://leaky_user:S3CRET-pw@${host}/${database}?sslmode=require`;

const previewEnv = (extra: Record<string, string | undefined> = {}) => ({
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_SHA: COMMIT,
  VERCEL_DEPLOYMENT_ID: DEPLOYMENT,
  DATABASE_URL: url(PREVIEW_POOLED),
  DATABASE_URL_UNPOOLED: url(PREVIEW_DIRECT),
  ...extra,
});

const context = {
  environment: "preview",
  commit: COMMIT,
  deployment: DEPLOYMENT,
};

describe("endpointIdentity", () => {
  it("is deterministic and pinned by golden vectors (the validation procedure depends on it)", () => {
    expect(
      endpointIdentity(
        "pooled",
        { hostname: PREVIEW_POOLED, database: "neondb" },
        context,
      ),
    ).toBe("ad9dc63260be0ea7");
    expect(
      endpointIdentity(
        "unpooled",
        { hostname: PREVIEW_DIRECT, database: "neondb" },
        context,
      ),
    ).toBe("ac5a0f599b2fd879");
  });

  it("changes with every bound input", () => {
    const base = { hostname: PREVIEW_POOLED, database: "neondb" };
    const reference = endpointIdentity("pooled", base, context);
    const variants = [
      endpointIdentity("unpooled", base, context),
      endpointIdentity("pooled", { ...base, hostname: PROD_POOLED }, context),
      endpointIdentity("pooled", { ...base, database: "other" }, context),
      endpointIdentity("pooled", { ...base, port: "6543" }, context),
      endpointIdentity("pooled", base, {
        ...context,
        environment: "production",
      }),
      endpointIdentity("pooled", base, { ...context, commit: "f".repeat(40) }),
      endpointIdentity("pooled", base, { ...context, deployment: "dpl_OTHER" }),
    ];
    for (const variant of variants) expect(variant).not.toBe(reference);
    expect(new Set(variants).size).toBe(variants.length);
  });

  it("treats the host case-insensitively and the default port as 5432", () => {
    const a = endpointIdentity(
      "pooled",
      { hostname: PREVIEW_POOLED.toUpperCase(), port: "5432", database: "d" },
      context,
    );
    const b = endpointIdentity(
      "pooled",
      { hostname: PREVIEW_POOLED, database: "d" },
      context,
    );
    expect(a).toBe(b);
  });

  it("encodes fields unambiguously", () => {
    const a = endpointIdentity(
      "pooled",
      { hostname: "a", database: "b,c" },
      context,
    );
    const b = endpointIdentity(
      "pooled",
      { hostname: "a,b", database: "c" },
      context,
    );
    expect(a).not.toBe(b);
  });
});

describe("endpointParts", () => {
  it("drops credentials and query", () => {
    expect(endpointParts(url("Host.Example.com:6543", "my%20db"))).toEqual({
      hostname: "host.example.com",
      port: "6543",
      database: "my db",
    });
  });
});

describe("describeDatabaseIdentity", () => {
  it("is silent outside Preview (Production behavior is unchanged)", () => {
    for (const env of [
      {},
      { DATABASE_URL: url(PROD_POOLED) },
      { VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: url(PROD_POOLED) },
      previewEnv({ VERCEL_ENV: "production" }),
      previewEnv({ VERCEL_ENV: "development" }),
      previewEnv({ VERCEL_ENV: "staging" }),
      previewEnv({ VERCEL_ENV: "Preview" }),
      previewEnv({ VERCEL_ENV: "" }),
    ])
      expect(describeDatabaseIdentity(env)).toBeUndefined();
  });

  it("prints the line with environment, commit, deployment and both identifiers", () => {
    expect(describeDatabaseIdentity(previewEnv())).toBe(
      `[db:identity] v1 env=preview commit=${COMMIT} deployment=${DEPLOYMENT} pooled=ad9dc63260be0ea7 unpooled=ac5a0f599b2fd879`,
    );
  });

  it("never contains credentials, the host, the database or the URL", () => {
    const line = describeDatabaseIdentity(previewEnv())!;
    for (const secret of [
      "leaky_user",
      "S3CRET",
      "postgresql",
      "neondb",
      "sslmode",
      "ep-test-preview",
      "neon.tech",
      "@",
    ])
      expect(line).not.toContain(secret);
  });

  it("uses the pooled variable for 'pooled' and the unpooled variable for 'unpooled'", () => {
    const line = parseIdentityLine(
      describeDatabaseIdentity(
        previewEnv({ DATABASE_URL_UNPOOLED: url(PROD_DIRECT) }),
      )!,
    )!;
    const expectedPooled = endpointIdentity(
      "pooled",
      { hostname: PREVIEW_POOLED, database: "neondb" },
      context,
    );
    const expectedUnpooled = endpointIdentity(
      "unpooled",
      { hostname: PROD_DIRECT, database: "neondb" },
      context,
    );
    expect(line.pooled).toBe(expectedPooled);
    expect(line.unpooled).toBe(expectedUnpooled);
  });

  it("reports unset and unavailable states without throwing or echoing values", () => {
    const noUnpooled = describeDatabaseIdentity(
      previewEnv({ DATABASE_URL_UNPOOLED: undefined }),
    )!;
    expect(noUnpooled).toMatch(
      /unpooled=unset warning=incomplete-not-evidence-of-isolation$/,
    );
    const none = describeDatabaseIdentity(
      previewEnv({ DATABASE_URL: undefined, DATABASE_URL_UNPOOLED: undefined }),
    )!;
    expect(none).toMatch(
      /pooled=unavailable unpooled=unavailable warning=incomplete-not-evidence-of-isolation$/,
    );
    const garbage = describeDatabaseIdentity(
      previewEnv({
        DATABASE_URL: "not a url leaky_user:S3CRET",
        DATABASE_URL_UNPOOLED: "mysql://leaky_user:S3CRET@h/db",
      }),
    )!;
    expect(garbage).toMatch(
      /pooled=unavailable unpooled=unavailable warning=incomplete-not-evidence-of-isolation$/,
    );
    expect(garbage).not.toContain("S3CRET");
  });

  it("reports an unexpected failure as a sanitized notice, never as silence", () => {
    const hostile = new Proxy(previewEnv(), {
      get(target, property) {
        if (property === "VERCEL_GIT_COMMIT_SHA")
          throw new Error("boom leaky_user:S3CRET");
        return Reflect.get(target, property);
      },
    });
    const line = describeDatabaseIdentity(hostile);
    expect(line).toBe(DIAGNOSTIC_FAILED_LINE);
    expect(line).toContain("not-evidence-of-isolation");
    expect(line).not.toContain("boom");
    expect(line).not.toContain("S3CRET");
  });

  it("never produces a verifiable line from a failure, incomplete or absent output", () => {
    const preview = {
      pooledHost: PREVIEW_POOLED,
      unpooledHost: PREVIEW_DIRECT,
      database: "neondb",
    };
    expect(() => verifyIdentityLine(DIAGNOSTIC_FAILED_LINE, preview)).toThrow(
      /\[db:identity\]/,
    );
    const incomplete = describeDatabaseIdentity(
      previewEnv({ DATABASE_URL_UNPOOLED: undefined }),
    )!;
    expect(verifyIdentityLine(incomplete, preview).unpooled).toBe("MISMATCH");
    expect(() => verifyIdentityLine("", preview)).toThrow();
  });

  it("marks missing commit and deployment as unknown", () => {
    expect(
      describeDatabaseIdentity(
        previewEnv({
          VERCEL_GIT_COMMIT_SHA: undefined,
          VERCEL_DEPLOYMENT_ID: undefined,
        }),
      ),
    ).toContain("commit=unknown deployment=unknown");
  });
});

describe("verifyIdentityLine", () => {
  const line = describeDatabaseIdentity(previewEnv())!;
  const preview = {
    pooledHost: PREVIEW_POOLED,
    unpooledHost: PREVIEW_DIRECT,
    database: "neondb",
  };

  it("matches the authoritative Preview endpoint", () => {
    expect(verifyIdentityLine(line, preview)).toEqual({
      pooled: "MATCH",
      unpooled: "MATCH",
    });
  });

  it("flags the Production endpoint as a mismatch, for each role", () => {
    expect(
      verifyIdentityLine(line, {
        pooledHost: PROD_POOLED,
        unpooledHost: PROD_DIRECT,
        database: "neondb",
      }),
    ).toEqual({ pooled: "MISMATCH", unpooled: "MISMATCH" });
    expect(
      verifyIdentityLine(line, { ...preview, pooledHost: PROD_POOLED }),
    ).toEqual({ pooled: "MISMATCH", unpooled: "MATCH" });
  });

  it("flags a different database name", () => {
    expect(verifyIdentityLine(line, { ...preview, database: "x" })).toEqual({
      pooled: "MISMATCH",
      unpooled: "MISMATCH",
    });
  });

  it("is bound to the logged commit and deployment (a tampered line does not verify)", () => {
    const tampered = line.replace(COMMIT, "f".repeat(40));
    expect(verifyIdentityLine(tampered, preview)).toEqual({
      pooled: "MISMATCH",
      unpooled: "MISMATCH",
    });
  });

  it("accepts the line inside surrounding build-log text and rejects anything else", () => {
    expect(verifyIdentityLine(`12:00:00.000 ${line}\n`, preview).pooled).toBe(
      "MATCH",
    );
    expect(() => verifyIdentityLine("nothing here", preview)).toThrow(
      /\[db:identity\]/,
    );
    expect(() =>
      verifyIdentityLine(line.replace(" v1 ", " v2 "), preview),
    ).toThrow(/v1/);
  });
});
