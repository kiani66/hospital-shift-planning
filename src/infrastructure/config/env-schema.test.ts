import { describe, expect, it } from "vitest";

import {
  EnvValidationError,
  migrationDatabaseUrl,
  parseEnv,
  serverEnvSchema,
} from "./env-schema";

const SECRET_URL = "postgresql://app:s3cr3t-password@db.example.com:5432/hsp";

describe("serverEnvSchema", () => {
  it("accepts a postgres connection URL", () => {
    expect(parseEnv(serverEnvSchema, { DATABASE_URL: SECRET_URL })).toEqual({
      DATABASE_URL: SECRET_URL,
    });
  });

  it("accepts the postgres:// scheme alias", () => {
    const url = "postgres://app:pw@localhost/hsp";
    expect(parseEnv(serverEnvSchema, { DATABASE_URL: url }).DATABASE_URL).toBe(
      url,
    );
  });

  it("reports a missing variable by name", () => {
    expect(() => parseEnv(serverEnvSchema, {})).toThrowError(
      /DATABASE_URL: is required/,
    );
  });

  it("rejects non-postgres URLs", () => {
    expect(() =>
      parseEnv(serverEnvSchema, {
        DATABASE_URL: "mysql://app:pw@localhost/hsp",
      }),
    ).toThrowError(EnvValidationError);
  });

  it("never echoes variable values in the error message", () => {
    const leaky = "https://app:s3cr3t-password@db.example.com/hsp";
    try {
      parseEnv(serverEnvSchema, { DATABASE_URL: leaky });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("s3cr3t-password");
    }
  });
});

describe("migrationDatabaseUrl", () => {
  it("prefers the unpooled connection", () => {
    expect(
      migrationDatabaseUrl({
        DATABASE_URL: "postgresql://pooled@host/db",
        DATABASE_URL_UNPOOLED: "postgresql://direct@host/db",
      }),
    ).toBe("postgresql://direct@host/db");
  });

  it("falls back to DATABASE_URL", () => {
    expect(
      migrationDatabaseUrl({ DATABASE_URL: "postgresql://pooled@host/db" }),
    ).toBe("postgresql://pooled@host/db");
  });

  it("fails when neither is set", () => {
    expect(() => migrationDatabaseUrl({})).toThrowError(
      /DATABASE_URL_UNPOOLED or DATABASE_URL/,
    );
  });
});
