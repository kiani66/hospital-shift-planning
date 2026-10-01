import type { z } from "zod";

import type { Actor } from "../domain/authz/actor";
import {
  authorize,
  type Action,
  type ActionResources,
} from "../domain/authz/policies";
import { unwrap } from "../domain/shared/result";
import type { Database, Transaction } from "../infrastructure/db/database";
import {
  recordAuditEvent,
  type NewAuditEvent,
} from "../infrastructure/repositories/audit";
import {
  insertNotifications,
  type NewNotification,
} from "../infrastructure/repositories/notifications";
import { toActionError, type ActionResult } from "./result";
import {
  NO_STAFFING_REQUIREMENTS,
  type StaffingRequirementsSource,
} from "./schedules/staffing-requirements";

/** Who is calling and with what. Built per request by the (Phase 3) adapter. */
export interface AppContext {
  readonly db: Database;
  readonly actor: Actor;
  /** Injectable clock for deterministic tests. */
  readonly clock?: () => Date;
  /**
   * Where staffing bounds come from (D44). Defaults to the source that
   * configures nothing, so no staffing finding exists until numbers do.
   */
  readonly staffing?: StaffingRequirementsSource;
}

/** What a command handler works with: one transaction plus audit and notification writers bound to it. */
export interface UnitOfWork {
  readonly tx: Transaction;
  readonly actor: Actor;
  readonly now: Date;
  /** Staffing bounds for validation (`AppContext.staffing` or none configured). */
  readonly staffing: StaffingRequirementsSource;
  /** Throws `ForbiddenError` (rolling back) unless the policy allows the action. */
  authorize<A extends Action>(action: A, resource: ActionResources[A]): void;
  /** Appends an audit event in this transaction; the actor is filled in. */
  audit(event: Omit<NewAuditEvent, "actorId">): Promise<void>;
  /** Writes in-app notifications in this transaction. */
  notify(notifications: readonly NewNotification[]): Promise<void>;
}

class MissingAuthorizationError extends Error {
  override readonly name = "MissingAuthorizationError";
}

/**
 * Defines a command: validates input, then runs `handler` inside a single
 * database transaction. Any thrown error rolls back every write (business
 * rows, audit events, notifications) and is mapped to a stable `ActionResult`.
 *
 * Every handler must call `uow.authorize` at least once; one that does not is
 * rolled back and reported as INTERNAL, so a forgotten check fails closed.
 */
export function defineCommand<S extends z.ZodType, O>(definition: {
  readonly name: string;
  readonly input: S;
  readonly handler: (uow: UnitOfWork, input: z.output<S>) => Promise<O>;
}) {
  return async function execute(
    ctx: AppContext,
    rawInput: unknown,
  ): Promise<ActionResult<O>> {
    const parsed = definition.input.safeParse(rawInput);
    if (!parsed.success)
      return { ok: false, error: toActionError(parsed.error) };

    try {
      const data = await ctx.db.transaction(async (tx) => {
        let authorized = false;
        const uow: UnitOfWork = {
          tx,
          actor: ctx.actor,
          now: ctx.clock?.() ?? new Date(),
          staffing: ctx.staffing ?? NO_STAFFING_REQUIREMENTS,
          authorize(action, resource) {
            unwrap(authorize(ctx.actor, action, resource));
            authorized = true;
          },
          audit: (event) =>
            recordAuditEvent(tx, { ...event, actorId: ctx.actor.userId }),
          notify: async (notifications) => {
            await insertNotifications(tx, notifications);
          },
        };
        const result = await definition.handler(uow, parsed.data);
        if (!authorized)
          throw new MissingAuthorizationError(
            `${definition.name} did not authorize`,
          );
        return result;
      });
      return { ok: true, data };
    } catch (error) {
      const mapped = toActionError(error);
      if (mapped.code === "INTERNAL") {
        const cause = (error as { cause?: { message?: string } }).cause
          ?.message;
        console.error(
          `[${definition.name}] unexpected error:`,
          cause ?? (error as Error).message ?? error,
        );
      }
      return { ok: false, error: mapped };
    }
  };
}
