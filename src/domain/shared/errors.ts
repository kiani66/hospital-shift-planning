import type { Violation } from "../rules/violation";

/**
 * Error codes the application layer maps to its action result contract.
 * NOT_FOUND and CONFLICT are raised by the application/persistence layers.
 */
export type DomainErrorCode =
  "VALIDATION" | "FORBIDDEN" | "INVALID_STATE" | "RULE_VIOLATION";

export abstract class DomainError extends Error {
  abstract readonly code: DomainErrorCode;
}

/** Input is malformed or out of range (bad date, empty scope, missing comment). */
export class ValidationError extends DomainError {
  override readonly name = "ValidationError";
  readonly code = "VALIDATION";

  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

/** The actor is not allowed to perform the action. */
export class ForbiddenError extends DomainError {
  override readonly name = "ForbiddenError";
  readonly code = "FORBIDDEN";

  constructor(readonly reason: string) {
    super(`Forbidden: ${reason}`);
  }
}

/**
 * The action is not allowed in the current status of the schedule (or of
 * another stateful subject, such as a change request).
 */
export class InvalidStateError extends DomainError {
  override readonly name = "InvalidStateError";
  readonly code = "INVALID_STATE";

  constructor(
    readonly status: string,
    readonly attempted: string,
    subject = "the schedule",
  ) {
    super(`Cannot ${attempted} while ${subject} is ${status}`);
  }
}

/** Blocking scheduling-rule violations prevent the action (e.g. night-rest on FINALIZE). */
export class RuleViolationError extends DomainError {
  override readonly name = "RuleViolationError";
  readonly code = "RULE_VIOLATION";

  constructor(readonly violations: readonly Violation[]) {
    super(`${violations.length} blocking rule violation(s)`);
  }
}
