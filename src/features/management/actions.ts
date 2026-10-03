"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createAccount,
  setAccountActive,
  updateAccountProfile,
} from "@/application/management/accounts";
import {
  addDepartmentMembership,
  endDepartmentMembership,
  transitionDepartmentMembership,
} from "@/application/management/memberships";
import type { ActionResult } from "@/application/result";
import { requireRequestContext } from "@/features/auth/guards";

import { parseManagementForm, type ManagementOperation } from "./form-schema";
import {
  invalidManagementForm,
  managementResponse,
  type ManagementFormState,
} from "./mutation-result";

const commands = {
  create: createAccount,
  profile: updateAccountProfile,
  status: setAccountActive,
  add: addDepartmentMembership,
  end: endDepartmentMembership,
  transfer: transitionDepartmentMembership,
  role: transitionDepartmentMembership,
} as const;

/** Parse presentation inputs, load trusted actor, invoke the existing transactional command. */
async function submit(
  operation: ManagementOperation,
  formData: FormData,
): Promise<ManagementFormState> {
  const parsed = parseManagementForm(operation, formData);
  if (!parsed.success) return invalidManagementForm(parsed.error);
  const ctx = await requireRequestContext();
  const result: ActionResult<unknown> = await commands[operation](
    ctx,
    parsed.data,
  );
  if (result.ok) {
    // Actor memberships affect shell navigation and all scheduling eligibility views.
    revalidatePath("/", "layout");
    if (
      operation === "status" &&
      "userId" in parsed.data &&
      "isActive" in parsed.data &&
      parsed.data.userId === ctx.actor.userId &&
      !parsed.data.isActive
    )
      redirect("/login");
  }
  const userId =
    operation === "create" && result.ok
      ? (result.data as { id: string }).id
      : undefined;
  return { ...managementResponse(operation, result, userId), at: Date.now() };
}

export async function createAccountAction(
  _previous: ManagementFormState,
  formData: FormData,
) {
  return submit("create", formData);
}
export async function updateProfileAction(
  _previous: ManagementFormState,
  formData: FormData,
) {
  return submit("profile", formData);
}
export async function setAccountActiveAction(
  _previous: ManagementFormState,
  formData: FormData,
) {
  return submit("status", formData);
}
export async function addMembershipAction(
  _previous: ManagementFormState,
  formData: FormData,
) {
  return submit("add", formData);
}
export async function endMembershipAction(
  _previous: ManagementFormState,
  formData: FormData,
) {
  return submit("end", formData);
}
export async function transferMembershipAction(
  _previous: ManagementFormState,
  formData: FormData,
) {
  return submit("transfer", formData);
}
export async function changeMembershipRoleAction(
  _previous: ManagementFormState,
  formData: FormData,
) {
  return submit("role", formData);
}
