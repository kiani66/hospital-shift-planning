import { describe, expect, it } from "vitest";

import { toActionError } from "@/application/result";
import { ValidationError } from "@/domain/shared/errors";

import { managementFormSchemas, type ManagementOperation } from "./form-schema";
import {
  invalidManagementForm,
  managementFailure,
  managementResponse,
} from "./mutation-result";

describe("safe Persian management feedback", () => {
  it.each(["PROFILE_CHANGED", "ACCOUNT_STATUS_CHANGED", "MEMBERSHIP_CHANGED"])(
    "explains stale %s without raw server messages",
    (reason) => {
      const state = managementFailure("profile", {
        code: "CONFLICT",
        message: "password hash secret",
        reason,
      });
      expect(state.message).toContain("صفحه را تازه کنید");
      expect(JSON.stringify(state)).not.toMatch(/password|hash|secret/);
    },
  );
  it.each([
    "INVALID_RELATION_RANGE",
    "RELATION_NOT_CURRENT",
    "END_IN_PAST",
    "TERM_EXTENSION",
    "TRANSITION_HISTORY_BOUNDARY",
    "LAST_ACTIVE_ADMIN",
    "UNCHANGED_TRANSITION",
  ])("presents a stable business reason %s", (reason) => {
    const state = managementFailure("transfer", {
      code: "VALIDATION",
      message: "internal-only",
      reason,
      fieldErrors: { startedOn: ["internal-only"] },
    });
    expect(state.message).toMatch(/[\u0600-\u06ff]/);
    expect(state.fields?.startedOn).toBe(state.message);
    expect(JSON.stringify(state)).not.toContain("internal-only");
  });
  it.each([
    "FORBIDDEN",
    "NOT_FOUND",
    "VALIDATION",
    "INTERNAL",
    "INVALID_STATE",
    "RULE_VIOLATION",
  ] as const)("safely handles %s", (code) => {
    const state = managementFailure("profile", {
      code,
      message: "token=secret",
    });
    expect(state.status).toBe("error");
    expect(state.message).toMatch(/[\u0600-\u06ff]/);
    expect(JSON.stringify(state)).not.toMatch(/token|secret/);
  });
  it.each(["create", "profile", "add"] as const)(
    "words conflict in %s context",
    (operation) => {
      const state = managementFailure(operation, {
        code: "CONFLICT",
        message: "driver details",
      });
      expect(state.message).toContain(
        operation === "create" || operation === "profile"
          ? "ایمیل"
          : "هم‌پوشانی",
      );
      if (operation === "create")
        expect(state.fields?.email).toBe(state.message);
    },
  );
  it("filters unknown error fields and does not echo validation values", () => {
    const state = managementFailure("profile", {
      code: "VALIDATION",
      message: "secret",
      fieldErrors: { displayName: ["secret"], passwordHash: ["hash"] },
      reason: "unknown internal reason",
    });
    expect(Object.keys(state.fields!)).toEqual(["displayName"]);
    const parsed = managementFormSchemas.create.safeParse({
      displayName: "",
      email: "invalid",
      password: "secret",
    });
    if (parsed.success) throw new Error("expected validation");
    const validation = invalidManagementForm(parsed.error);
    expect(Object.keys(validation.fields!).sort()).toEqual([
      "displayName",
      "email",
      "password",
    ]);
    expect(JSON.stringify(validation)).not.toContain("secret");
  });
  it("preserves domain reason codes through the application contract", () => {
    expect(
      toActionError(
        new ValidationError(
          "technical details",
          "startedOn",
          "TRANSITION_HISTORY_BOUNDARY",
        ),
      ),
    ).toMatchObject({
      reason: "TRANSITION_HISTORY_BOUNDARY",
      fieldErrors: { startedOn: ["technical details"] },
    });
  });
  it.each([
    "create",
    "profile",
    "status",
    "add",
    "end",
    "transfer",
    "role",
  ] as ManagementOperation[])(
    "drops successful command data for %s",
    (operation) => {
      const dto = managementResponse(operation, {
        ok: true,
        data: {
          password: "secret",
          passwordHash: "hash",
          isHospitalAdmin: true,
          id: "internal",
        },
      });
      expect(Object.keys(dto).sort()).toEqual(["message", "status"]);
      expect(JSON.stringify(dto)).not.toMatch(
        /secret|hash|internal|isHospitalAdmin/,
      );
    },
  );
  it("never returns an invalid destination or a destination for other mutations", () => {
    expect(
      managementResponse(
        "create",
        { ok: true, data: {} },
        "/admin/personnel/new",
      ),
    ).not.toHaveProperty("userId");
    expect(
      managementResponse(
        "profile",
        { ok: true, data: {} },
        "20000000-0000-4000-8000-000000000011",
      ),
    ).not.toHaveProperty("userId");
  });
  it("returns only the explicit safe created-user destination on success", () => {
    const id = "20000000-0000-4000-8000-000000000011";
    expect(
      managementResponse(
        "create",
        { ok: true, data: { passwordHash: "secret" } },
        id,
      ),
    ).toMatchObject({ status: "success", userId: id });
    expect(
      managementResponse(
        "create",
        { ok: false, error: { code: "FORBIDDEN", message: "private" } },
        id,
      ),
    ).not.toHaveProperty("userId");
  });
});
