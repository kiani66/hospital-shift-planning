import { z } from "zod";

import {
  DomainError,
  ForbiddenError,
  InvalidStateError,
  RuleViolationError,
  ValidationError,
} from "../domain/shared/errors";
import type { Violation } from "../domain/rules/violation";
import {
  PG_CHECK_VIOLATION,
  PG_EXCLUSION_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
  pgErrorCode,
} from "../infrastructure/db/errors";
import { ApplicationError } from "./errors";

export type ActionErrorCode =
  | "VALIDATION"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "CONFLICT"
  | "RULE_VIOLATION"
  | "INTERNAL";

export interface ActionError {
  readonly code: ActionErrorCode;
  readonly message: string;
  /** Machine-readable detail, e.g. the authorization denial reason. */
  readonly reason?: string;
  readonly fieldErrors?: Record<string, string[]>;
  readonly violations?: readonly Violation[];
}

/** The stable contract every command returns; the UI branches on `code`, never on messages. */
export type ActionResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ActionError };

/** Maps any thrown value to an `ActionError`. Unexpected errors never leak their message. */
export function toActionError(error: unknown): ActionError {
  if (error instanceof DomainError) {
    if (error instanceof ValidationError) {
      return {
        code: "VALIDATION",
        message: error.message,
        ...(error.field && { fieldErrors: { [error.field]: [error.message] } }),
      };
    }
    if (error instanceof ForbiddenError) {
      return {
        code: "FORBIDDEN",
        message: "You are not allowed to do this",
        reason: error.reason,
      };
    }
    if (error instanceof RuleViolationError) {
      return {
        code: "RULE_VIOLATION",
        message: error.message,
        violations: error.violations,
      };
    }
    if (error instanceof InvalidStateError)
      return {
        code: "INVALID_STATE",
        message: error.message,
        // What was refused (e.g. FINALIZE, EDIT_ASSIGNMENT); lets the UI word it.
        reason: error.attempted,
      };
  }
  if (error instanceof ApplicationError)
    return {
      code: error.code,
      message: error.message,
      ...(error.reason && { reason: error.reason }),
    };
  if (error instanceof z.ZodError) {
    return {
      code: "VALIDATION",
      message: "Invalid input",
      fieldErrors: z.flattenError(error).fieldErrors as Record<
        string,
        string[]
      >,
    };
  }
  switch (pgErrorCode(error)) {
    case PG_UNIQUE_VIOLATION:
    case PG_EXCLUSION_VIOLATION:
      return { code: "CONFLICT", message: "This conflicts with existing data" };
    case PG_FOREIGN_KEY_VIOLATION:
    case PG_CHECK_VIOLATION:
      return {
        code: "VALIDATION",
        message: "The data is not consistent with existing records",
      };
  }
  return { code: "INTERNAL", message: "Something went wrong" };
}
