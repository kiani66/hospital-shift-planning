import { z } from "zod";

/**
 * Environment schemas. Kept free of `server-only` so scripts (migrations, seed)
 * and unit tests can import it. App code should use `getServerEnv()` from ./env.
 */

const postgresUrl = z.url({
  protocol: /^postgres(ql)?$/,
  error: "must be a postgres:// or postgresql:// connection URL",
});

export const serverEnvSchema = z.object({
  /** Pooled connection string used by the running app. */
  DATABASE_URL: postgresUrl,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export const migrationEnvSchema = z
  .object({
    /** Direct (non-pooled) connection string; preferred for migrations. */
    DATABASE_URL_UNPOOLED: postgresUrl.optional(),
    DATABASE_URL: postgresUrl.optional(),
  })
  .refine((env) => env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL, {
    error: "DATABASE_URL_UNPOOLED or DATABASE_URL must be set",
  });

export class EnvValidationError extends Error {
  override readonly name = "EnvValidationError";
}

/**
 * Parses `source` with `schema`. On failure, throws an error listing the
 * offending variable names and reasons only; values are never included
 * because they may contain credentials.
 */
export function parseEnv<TSchema extends z.ZodType>(
  schema: TSchema,
  source: Record<string, string | undefined>,
): z.infer<TSchema> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;

  const lines = result.error.issues.map((issue) => {
    const name = issue.path.length > 0 ? issue.path.join(".") : "(env)";
    const reason =
      issue.code === "invalid_type" ? "is required" : issue.message;
    return `  - ${name}: ${reason}`;
  });
  throw new EnvValidationError(
    `Invalid environment variables:\n${lines.join("\n")}`,
  );
}

/** Returns the connection string migrations should use (unpooled preferred). */
export function migrationDatabaseUrl(
  source: Record<string, string | undefined>,
): string {
  const env = parseEnv(migrationEnvSchema, source);
  // The refine above guarantees one of the two is present.
  return (env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL)!;
}
