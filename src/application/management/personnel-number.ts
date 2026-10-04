import { z } from "zod";

import { parsePersonnelNumber } from "../../domain/identity/personnel-number";
import { ValidationError } from "../../domain/shared/errors";
import {
  findUserByPersonnelNumber,
  setPersonnelNumber,
} from "../../infrastructure/repositories/users";
import { ConflictError } from "../errors";
import { defineCommand } from "../use-case";
import { authorizeAdministration, requireUser } from "./context";

/** Raw text from a form or CSV; normalized and validated by the domain. */
export const personnelNumberInput = z
  .string()
  .max(200)
  .transform((value, ctx) => {
    const parsed = parsePersonnelNumber(value);
    if (parsed.ok) return parsed.value;
    ctx.addIssue({ code: "custom", message: parsed.error.message });
    return z.NEVER;
  });

/**
 * Assigns a personnel number to an account without one (the audited legacy
 * backfill) or corrects a wrongly registered one. Never clears it: the input
 * must be a valid number. The internal user id, and therefore every record the
 * user owns, is untouched; only the sign-in identifier changes, so the old
 * number stops working at once while existing sessions and the account-level
 * throttle (keyed by user id) are unaffected.
 *
 * `expectedPersonnelNumber` is the value the admin saw (null for none), so a
 * concurrent correction is a conflict rather than an overwrite.
 */
export const setUserPersonnelNumber = defineCommand({
  name: "user.setPersonnelNumber",
  input: z.object({
    userId: z.uuid(),
    expectedPersonnelNumber: z.string().nullable(),
    personnelNumber: personnelNumberInput,
  }),
  async handler(uow, input) {
    await authorizeAdministration(uow, "user.setPersonnelNumber");
    const user = await requireUser(uow, input.userId);
    if (user.personnelNumber !== input.expectedPersonnelNumber)
      throw new ConflictError(undefined, "PERSONNEL_NUMBER_CHANGED");
    if (user.personnelNumber === input.personnelNumber) return user;
    const holder = await findUserByPersonnelNumber(
      uow.tx,
      input.personnelNumber,
    );
    if (holder)
      throw new ValidationError(
        "Personnel number already belongs to another account",
        "personnelNumber",
        "PERSONNEL_NUMBER_TAKEN",
      );
    await setPersonnelNumber(uow.tx, user.id, input.personnelNumber, uow.now);
    await uow.audit({
      action:
        user.personnelNumber === null
          ? "user.personnelNumberAssigned"
          : "user.personnelNumberCorrected",
      entityType: "user",
      entityId: user.id,
      data: { before: user.personnelNumber, after: input.personnelNumber },
    });
    return { ...user, personnelNumber: input.personnelNumber };
  },
});
