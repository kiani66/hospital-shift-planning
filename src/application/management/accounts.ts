import { z } from "zod";

import { assertActiveAdminRemains } from "../../domain/management/lifecycle";
import { hashPassword } from "../../infrastructure/auth/password";
import {
  countHospitalAdmins,
  updateAccount,
} from "../../infrastructure/repositories/management";
import { createUser } from "../../infrastructure/repositories/users";
import { ConflictError } from "../errors";
import { defineCommand } from "../use-case";
import { authorizeAdministration, requireUser } from "./context";
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
    assertActiveAdminRemains({
      wasActiveAdmin: user.isActive && user.isHospitalAdmin,
      willBeActiveAdmin: input.isActive && user.isHospitalAdmin,
      activeAdminCount: await countHospitalAdmins(uow.tx),
    });
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
  input: z.object({ userId: z.uuid(), isHospitalAdmin: z.boolean() }),
  async handler(uow, input) {
    await authorizeAdministration(uow, "user.setHospitalAdmin");
    const user = await requireUser(uow, input.userId);
    if (user.isHospitalAdmin === input.isHospitalAdmin) return user;
    assertActiveAdminRemains({
      wasActiveAdmin: user.isActive && user.isHospitalAdmin,
      willBeActiveAdmin: user.isActive && input.isHospitalAdmin,
      activeAdminCount: await countHospitalAdmins(uow.tx),
    });
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
