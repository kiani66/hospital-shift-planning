import { z } from "zod";

import { ValidationError } from "../../domain/shared/errors";
import type { Database } from "../../infrastructure/db/database";
import { recordAuditEvent } from "../../infrastructure/repositories/audit";
import {
  countHospitalAdmins,
  hasAccountCredentials,
  lockHospitalAdministration,
  updateAccount,
} from "../../infrastructure/repositories/management";
import { findUserByEmail } from "../../infrastructure/repositories/users";
import { ConflictError } from "../errors";
import { emailInput } from "./input";

const inputSchema = z.object({
  email: emailInput,
  confirm: z.literal("ESTABLISH_FIRST_HOSPITAL_ADMIN"),
});

/**
 * Explicit operator-only bootstrap, never exposed as a Server Action. The
 * privileged database connection is its authority; ordinary management uses
 * authenticated Hospital Admin commands. Refuses any existing admin, even inactive.
 */
export async function bootstrapHospitalAdmin(
  db: Database,
  rawInput: unknown,
  now: Date = new Date(),
) {
  const input = inputSchema.parse(rawInput);
  return db.transaction(async (tx) => {
    await lockHospitalAdministration(tx);
    if (await countHospitalAdmins(tx, false))
      throw new ConflictError("Hospital Admin already established");
    const user = await findUserByEmail(tx, input.email);
    if (!user?.isActive)
      throw new ValidationError(
        "Bootstrap requires an existing active account",
        "email",
      );
    if (!(await hasAccountCredentials(tx, user.id)))
      throw new ValidationError(
        "Bootstrap requires a password-provisioned account",
        "email",
      );
    await updateAccount(tx, user.id, { isHospitalAdmin: true }, now);
    await recordAuditEvent(tx, {
      actorId: user.id,
      action: "user.hospitalAdminBootstrapped",
      entityType: "user",
      entityId: user.id,
      data: { before: false, after: true, source: "operatorBootstrap" },
    });
    return { userId: user.id };
  });
}
