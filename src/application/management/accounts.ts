import { z } from "zod";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "../../domain/identity/password-policy";
import { ValidationError } from "../../domain/shared/errors";
import { hashPassword } from "../../infrastructure/auth/password";
import {
  hasAccountCredentials,
  updateAccount,
} from "../../infrastructure/repositories/management";
import {
  createUser,
  findUserByEmail,
  findUserByPersonnelNumber,
} from "../../infrastructure/repositories/users";
import { ConflictError } from "../errors";
import { defineCommand } from "../use-case";
import {
  assertUsableAdminRemains,
  authorizeAdministration,
  requireUser,
} from "./context";
import { issueTemporaryPasswordFor } from "./credentials";
import {
  displayNameInput,
  optionalEmailInput,
  optionalMobileInput,
} from "./input";
import { personnelNumberInput } from "./personnel-number";

/**
 * Creates one personnel account. A personnel number is required (unique,
 * digits only); e-mail and mobile are optional. By default the account has no
 * password and cannot sign in until a temporary password is issued, here
 * (`issueTemporaryPassword`, shown once) or later from the person's page.
 * An explicitly supplied initial password (older callers) is treated as
 * temporary too: it must be changed at the first sign-in.
 */
export const createAccount = defineCommand({
  name: "user.create",
  input: z.object({
    personnelNumber: personnelNumberInput,
    displayName: displayNameInput,
    email: optionalEmailInput,
    mobile: optionalMobileInput,
    issueTemporaryPassword: z.boolean().default(false),
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH)
      .max(PASSWORD_MAX_LENGTH)
      .optional(),
  }),
  async handler(uow, input) {
    await authorizeAdministration(uow, "user.create");
    if (input.password && input.issueTemporaryPassword)
      throw new ValidationError(
        "Choose either an initial password or a generated temporary one",
        "password",
      );
    if (await findUserByPersonnelNumber(uow.tx, input.personnelNumber))
      throw new ValidationError(
        "Personnel number already belongs to another account",
        "personnelNumber",
        "PERSONNEL_NUMBER_TAKEN",
      );
    if (input.email && (await findUserByEmail(uow.tx, input.email)))
      throw new ConflictError(
        "E-mail already belongs to another account",
        "EMAIL_TAKEN",
      );
    const user = await createUser(uow.tx, {
      personnelNumber: input.personnelNumber,
      email: input.email,
      mobile: input.mobile,
      displayName: input.displayName,
      passwordHash: input.password ? await hashPassword(input.password) : null,
      mustChangePassword: input.password !== undefined,
    });
    await uow.audit({
      action: "user.created",
      entityType: "user",
      entityId: user.id,
      data: {
        personnelNumber: user.personnelNumber,
        email: user.email,
        mobile: user.mobile,
        displayName: user.displayName,
        isActive: true,
        credentials: input.password ? "initial" : "none",
      },
    });
    const temporaryPassword = input.issueTemporaryPassword
      ? await issueTemporaryPasswordFor(uow, user, "single")
      : undefined;
    return { ...user, ...(temporaryPassword && { temporaryPassword }) };
  },
});

/**
 * Edits display name, e-mail and mobile. The personnel number has its own
 * audited command (`setUserPersonnelNumber`). E-mail may be removed only from
 * an account that keeps a personnel number to sign in with.
 */
export const updateAccountProfile = defineCommand({
  name: "user.updateProfile",
  input: z.object({
    userId: z.uuid(),
    email: optionalEmailInput,
    displayName: displayNameInput,
    mobile: optionalMobileInput.optional(),
    expectedEmail: z
      .string()
      .nullable()
      .transform((v) => (v === "" ? null : v)),
    expectedDisplayName: z.string(),
    expectedMobile: z
      .string()
      .nullish()
      .transform((v) => (v === "" || v === undefined ? null : v)),
  }),
  async handler(uow, input) {
    await authorizeAdministration(uow, "user.updateProfile");
    const user = await requireUser(uow, input.userId);
    const mobileGiven = input.mobile !== undefined;
    if (
      user.email !== input.expectedEmail ||
      user.displayName !== input.expectedDisplayName ||
      (mobileGiven && user.mobile !== input.expectedMobile)
    )
      throw new ConflictError(undefined, "PROFILE_CHANGED");
    const after = {
      email: input.email,
      displayName: input.displayName,
      mobile: mobileGiven ? (input.mobile ?? null) : user.mobile,
    };
    if (
      user.email === after.email &&
      user.displayName === after.displayName &&
      user.mobile === after.mobile
    )
      return user;
    if (after.email === null && user.personnelNumber === null)
      throw new ValidationError(
        "An account without a personnel number needs its e-mail to sign in",
        "email",
        "LOGIN_IDENTIFIER_REQUIRED",
      );
    await updateAccount(uow.tx, user.id, after, uow.now);
    await uow.audit({
      action: "user.profileChanged",
      entityType: "user",
      entityId: user.id,
      data: {
        before: {
          email: user.email,
          displayName: user.displayName,
          mobile: user.mobile,
        },
        after,
      },
    });
    return { ...user, ...after };
  },
});

export const setAccountActive = defineCommand({
  name: "user.setActive",
  input: z.object({
    userId: z.uuid(),
    isActive: z.boolean(),
    expectedIsActive: z.boolean().optional(),
  }),
  async handler(uow, input) {
    await authorizeAdministration(uow, "user.setActive");
    const user = await requireUser(uow, input.userId);
    if (
      input.expectedIsActive !== undefined &&
      user.isActive !== input.expectedIsActive
    )
      throw new ConflictError(undefined, "ACCOUNT_STATUS_CHANGED");
    if (user.isActive === input.isActive) return user;
    const hasCredentials = await hasAccountCredentials(uow.tx, user.id);
    if (input.isActive && user.isHospitalAdmin && !hasCredentials)
      throw new ValidationError(
        "Stored Hospital Admin authority requires provisioned credentials before activation",
        "hospitalAdmin",
        "ADMIN_ACTIVATION_REQUIRES_CREDENTIALS",
      );
    await assertUsableAdminRemains(
      uow,
      user,
      { ...user, isActive: input.isActive },
      hasCredentials,
    );
    await updateAccount(uow.tx, user.id, { isActive: input.isActive }, uow.now);
    await uow.audit({
      action: input.isActive ? "user.activated" : "user.deactivated",
      entityType: "user",
      entityId: user.id,
      data: { before: user.isActive, after: input.isActive },
    });
    return { ...user, isActive: input.isActive };
  },
});

export const setHospitalAdmin = defineCommand({
  name: "user.setHospitalAdmin",
  input: z.object({
    userId: z.uuid(),
    isHospitalAdmin: z.boolean(),
    expectedIsHospitalAdmin: z.boolean().optional(),
    expectedIsActive: z.boolean().optional(),
  }),
  async handler(uow, input) {
    await authorizeAdministration(uow, "user.setHospitalAdmin");
    const user = await requireUser(uow, input.userId);
    if (
      (input.expectedIsHospitalAdmin !== undefined &&
        user.isHospitalAdmin !== input.expectedIsHospitalAdmin) ||
      (input.expectedIsActive !== undefined &&
        user.isActive !== input.expectedIsActive)
    )
      throw new ConflictError(undefined, "ADMIN_AUTHORITY_CHANGED");
    if (user.isHospitalAdmin === input.isHospitalAdmin) return user;
    const hasCredentials = await hasAccountCredentials(uow.tx, user.id);
    if (input.isHospitalAdmin) {
      if (!hasCredentials)
        throw new ValidationError(
          "Hospital Admin grants require provisioned credentials",
          "hospitalAdmin",
          "ADMIN_GRANT_REQUIRES_CREDENTIALS",
        );
      if (!user.isActive)
        throw new ValidationError(
          "Hospital Admin grants require an active target account",
          "hospitalAdmin",
          "ADMIN_GRANT_REQUIRES_ACTIVE_ACCOUNT",
        );
    }
    await assertUsableAdminRemains(
      uow,
      user,
      { ...user, isHospitalAdmin: input.isHospitalAdmin },
      hasCredentials,
    );
    await updateAccount(
      uow.tx,
      user.id,
      { isHospitalAdmin: input.isHospitalAdmin },
      uow.now,
    );
    await uow.audit({
      action: "user.hospitalAdminChanged",
      entityType: "user",
      entityId: user.id,
      data: { before: user.isHospitalAdmin, after: input.isHospitalAdmin },
    });
    return { ...user, isHospitalAdmin: input.isHospitalAdmin };
  },
});
