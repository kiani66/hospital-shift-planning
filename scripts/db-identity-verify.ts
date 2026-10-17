/**
 * Compares a logged `[db:identity]` line from a Preview build with the
 * authoritative Neon hostnames. Pass hostnames only: connection strings,
 * credentials and URLs are refused.
 *
 *   pnpm db:identity-verify --line "<log line>" \
 *     --pooled-host <ep-...-pooler.region.aws.neon.tech> \
 *     --unpooled-host <ep-....region.aws.neon.tech> [--database neondb]
 *
 * Exit 0 only when both identifiers match.
 */
import { parseArgs } from "node:util";

import { verifyIdentityLine } from "../src/infrastructure/config/db-identity";

const HOSTNAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;
const DATABASE = /^[A-Za-z0-9_.-]+$/;

function main(): number {
  const { values } = parseArgs({
    options: {
      line: { type: "string" },
      "pooled-host": { type: "string" },
      "unpooled-host": { type: "string" },
      database: { type: "string", default: "neondb" },
    },
  });
  const pooledHost = values["pooled-host"];
  const unpooledHost = values["unpooled-host"];
  const database = values.database ?? "neondb";
  if (!values.line || !pooledHost || !unpooledHost) {
    console.error(
      "usage: db:identity-verify --line <log line> --pooled-host <host> --unpooled-host <host> [--database <name>]",
    );
    return 2;
  }
  if (
    !HOSTNAME.test(pooledHost) ||
    !HOSTNAME.test(unpooledHost) ||
    !DATABASE.test(database)
  ) {
    console.error(
      "refused: pass bare hostnames and a database name only (no URLs, credentials or ports)",
    );
    return 2;
  }
  try {
    const result = verifyIdentityLine(values.line, {
      pooledHost,
      unpooledHost,
      database,
    });
    console.log(`pooled: ${result.pooled}`);
    console.log(`unpooled: ${result.unpooled}`);
    return result.pooled === "MATCH" && result.unpooled === "MATCH" ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "failed");
    return 2;
  }
}

process.exit(main());
