import { z } from "zod";

import { ValidationError } from "../../domain/shared/errors";
import { hashPassword } from "../../infrastructure/auth/password";
import {
  hasAccountCredentials,
  updateAccount,
} from "../../infrastructure/repositories/management";
import { createUser } from "../../infrastructure/repositories/users";
import { ConflictError } from "../errors";
import { defineCommand } from "../use-case";
import {
  assertUsableAdminRemains,
  authorizeAdministration,
  requireUser,
} from "./context";
import { accountProfileInput } from "./input";

export const createAccount = defineCommand({
  name: "user.create",
  input: accountProfileInput.extend({ password: z.string().min(12).max(256) }),
  async handler(uow, input) {
    await authorizeAdministration(uow, "user.create");
    const user = await createUser(uow.tx, {
      email: input.email,
      displayName: input.displayName,
      passwordHash: await hashPassword(input.password),
    });
    await uow.audit({
      action: "user.created",
      entityType: "user",
      entityId: user.id,
      data: {
        email: user.email,
        displayName: user.displayName,
        isActive: true,
      },
    });
    return user;
  },
});

export const updateAccountProfile = defineCommand({
  name: "user.updateProfile",
  input: accountProfileInput.extend({
    userId: z.uuid(),
    expectedEmail: z.string(),
    expectedDisplayName: z.string(),
  }),
  async handler(uow, input) {
    await authorizeAdministration(uow, "user.updateProfile");
    const user = await requireUser(uow, input.userId);
    if (
      user.email !== input.expectedEmail ||
      user.displayName !== input.expectedDisplayName
    )
      throw new ConflictError(undefined, "PROFILE_CHANGED");
    const after = { email: input.email, displayName: input.displayName };
    if (user.email === after.email && user.displayName === after.displayName)
      return user;
    await updateAccount(uow.tx, user.id, after, uow.now);
    await uow.audit({
      action: "user.profileChanged",
      entityType: "user",
      entityId: user.id,
      data: {
        before: { email: user.email, displayName: user.displayName },
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
