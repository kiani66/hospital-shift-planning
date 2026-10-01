/** Failures raised by the application layer (the domain has its own in domain/shared/errors). */
export abstract class ApplicationError extends Error {
  abstract readonly code: "NOT_FOUND" | "CONFLICT";
  /** Machine-readable detail for the UI (e.g. DUPLICATE_ACTIVE_REQUEST). */
  readonly reason?: string;
}

export class NotFoundError extends ApplicationError {
  override readonly name = "NotFoundError";
  readonly code = "NOT_FOUND";

  constructor(readonly entity: string) {
    super(`${entity} not found`);
  }
}

/** The data changed since the caller read it (stale revision) or clashes with existing data. */
export class ConflictError extends ApplicationError {
  override readonly name = "ConflictError";
  readonly code = "CONFLICT";

  constructor(
    message = "The data was changed by someone else; reload and try again",
    override readonly reason?: string,
  ) {
    super(message);
  }
}
