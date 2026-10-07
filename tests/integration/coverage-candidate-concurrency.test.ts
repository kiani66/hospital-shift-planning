import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  endDepartmentMembership,
  transitionDepartmentMembership,
} from "../../src/application/management/memberships";
import { assignCoverageCandidate } from "../../src/application/schedules/coverage-candidates";
import { setAssignments } from "../../src/application/schedules/edit-assignments";
import type { Actor } from "../../src/domain/authz/actor";
import { findNightRestViolations } from "../../src/domain/rules/night-rest";
import { isoDate } from "../../src/domain/shared/dates";
import { createDatabase } from "../../src/infrastructure/db/database";
import {
  departmentMemberships,
  users,
} from "../../src/infrastructure/db/schema";
import {
  DEMO_ICU,
  DEMO_ER,
  DEMO_SCHEDULE,
  DEMO_USERS,
} from "../../src/infrastructure/db/seed/demo-data";
import { listAssignments } from "../../src/infrastructure/repositories/assignments";
import { listAuditEventsForSchedule } from "../../src/infrastructure/repositories/audit";
import {
  loadActor,
  addMembership,
} from "../../src/infrastructure/repositories/memberships";
import {
  addToRoster,
  snapshotRosterFromMemberships,
} from "../../src/infrastructure/repositories/roster";
import {
  createSchedule,
  findScheduleById,
} from "../../src/infrastructure/repositories/schedules";
import { createUser } from "../../src/infrastructure/repositories/users";
import { setupTestDatabase } from "./support/database";

const { db, pool, url } = setupTestDatabase();
const S = DEMO_SCHEDULE.id;
const NURSE = DEMO_USERS.icuNurse2.id;
const HEAD = DEMO_USERS.icuHead.id;
const CLOCK = () => new Date("2026-10-07T12:00:00Z");
let actor: Actor;
let membershipId: string;
const clients: ReturnType<typeof createDatabase>[] = [];

beforeEach(async () => {
  await db
    .update(users)
    .set({ isHospitalAdmin: true })
    .where(eq(users.id, HEAD));
  actor = (await loadActor(db, HEAD, isoDate("2026-10-07")))!;
  const [membership] = await db
    .select({ id: departmentMemberships.id })
    .from(departmentMemberships)
    .where(
      and(
        eq(departmentMemberships.userId, NURSE),
        eq(departmentMemberships.departmentId, DEMO_ICU.id),
      ),
    );
  membershipId = membership!.id;
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map(({ pool }) => pool.end()));
});

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** Test-only query barrier, after PostgreSQL returned the protected read. */
function connection(name: string, pause?: (statement: string) => boolean) {
  const value = createDatabase(url, { max: 1, application_name: name });
  clients.push(value);
  const reached = barrier();
  const hold = barrier();
  const statements: string[] = [];
  let stopped = false;
  value.pool.on("connect", (client) => {
    const original = client.query.bind(client) as (
      ...args: never[]
    ) => Promise<unknown>;
    client.query = (async (...args: never[]) => {
      const first: unknown = args[0];
      const statement =
        typeof first === "string" ? first : (first as { text: string }).text;
      statements.push(statement);
      const result = await original(...args);
      if (!stopped && pause?.(statement)) {
        stopped = true;
        reached.release();
        await hold.promise;
      }
      return result;
    }) as typeof client.query;
  });
  return { ...value, reached, hold, statements };
}

async function waitForBarrier(value: ReturnType<typeof connection>) {
  // A timeout is a failure bound, not an assumed amount of scheduling time.
  await vi.waitFor(() =>
    expect(value.statements.some((s) => s.includes("begin"))).toBe(true),
  );
  await Promise.race([
    value.reached.promise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("query barrier not reached")),
        5_000,
      );
      value.reached.promise.then(() => clearTimeout(timer));
    }),
  ]);
}

async function waiting(name: string, blockers?: string) {
  await vi.waitFor(
    async () => {
      const result = await pool.query<{ waiting: boolean }>(
        `
      select exists (
        select 1 from pg_stat_activity w
        where w.datname = current_database() and w.application_name = $1
          and w.wait_event_type = 'Lock'
          and ($2::text is null or exists (
            select 1 from pg_stat_activity b
            where b.pid = any(pg_blocking_pids(w.pid)) and b.application_name = $2
          ))
      ) as waiting`,
        [name, blockers ?? null],
      );
      expect(result.rows[0]!.waiting).toBe(true);
    },
    { timeout: 5_000, interval: 20 },
  );
}
const adjacentRead = (s: string) =>
  s.includes('from "shift_assignments" inner join "schedules"');
// Matches both the old EXISTS eligibility read and the new locking join, for baseline proof.
const eligibilityRead = (s: string) =>
  s.includes('from "schedule_roster"') &&
  s.includes('"department_memberships"');
const context = (c: ReturnType<typeof connection>) => ({
  db: c.db,
  actor,
  clock: CLOCK,
});
async function input(
  scheduleId = S,
  date = "2026-10-25",
  shift = "M",
  nurseId = NURSE,
) {
  return {
    scheduleId,
    date,
    shift,
    nurseId,
    expectedRevision: (await findScheduleById(db, scheduleId))!.revision,
  };
}
async function nextSchedule() {
  // Deliberately sorts BEFORE S: UUID order is independent of chronological/start order.
  const next = await createSchedule(db, {
    id: "30000000-0000-4000-8000-000000000000",
    departmentId: DEMO_ICU.id,
    period: { start: isoDate("2026-11-22"), end: isoDate("2026-12-21") },
    label: "آذر ۱۴۰۵",
    createdBy: HEAD,
  });
  await snapshotRosterFromMemberships(db, {
    scheduleId: next.id,
    addedBy: HEAD,
  });
  return next;
}
async function state(scheduleId = S) {
  return {
    assignments: await listAssignments(db, scheduleId),
    audit: await listAuditEventsForSchedule(db, scheduleId),
    schedule: await findScheduleById(db, scheduleId),
    extra: (
      await db.execute(sql`select (select count(*) from schedule_changes)::int as changes,
      (select count(*) from schedule_revisions)::int as revisions`)
    ).rows,
  };
}

// The first real command is paused AFTER its adjacent read; under 38fdbf6
// the second also reads an empty boundary and commits. Under this protocol
// PostgreSQL exposes the second as blocked BEFORE it can read that boundary.
describe("protected adjacent schedule assessment", () => {
  it.each(["night-first", "morning-first"])(
    "serializes opposite-boundary Candidate writes: %s",
    async (order) => {
      const next = await nextSchedule();
      const night = await input(S, "2026-11-21", "N");
      const morning = await input(next.id, "2026-11-22", "M");
      const firstInput = order === "night-first" ? night : morning;
      const secondInput = order === "night-first" ? morning : night;
      const first = connection("boundary-first", adjacentRead);
      const second = connection("boundary-second");
      const before = await state(secondInput.scheduleId);
      const p1 = assignCoverageCandidate(context(first), firstInput);
      let p2: ReturnType<typeof assignCoverageCandidate> | undefined;
      try {
        await waitForBarrier(first);
        p2 = assignCoverageCandidate(context(second), secondInput);
        await waiting("boundary-second", "boundary-first");
        expect(second.statements.some(adjacentRead)).toBe(false);
      } finally {
        first.hold.release();
      }
      expect(await p1).toMatchObject({ ok: true });
      expect(await p2).toMatchObject({
        ok: false,
        error: {
          code: "RULE_VIOLATION",
          violations: [
            {
              rule: "NIGHT_REST",
              nurseId: NURSE,
              nightDate: "2026-11-21",
              date: "2026-11-22",
              shift: "M",
            },
          ],
        },
      });
      expect(await state(secondInput.scheduleId)).toEqual(before);
      const cells = [
        ...(await listAssignments(db, S)),
        ...(await listAssignments(db, next.id)),
      ];
      expect(
        findNightRestViolations(cells).filter((v) => v.nurseId === NURSE),
      ).toEqual([]);
    },
  );

  it("allows valid concurrent boundary assignments after waiting and re-reading", async () => {
    const next = await nextSchedule();
    const first = connection("valid-first", adjacentRead);
    const second = connection("valid-second");
    const p1 = assignCoverageCandidate(
      context(first),
      await input(S, "2026-11-21", "E"),
    );
    let p2: ReturnType<typeof assignCoverageCandidate> | undefined;
    try {
      await waitForBarrier(first);
      p2 = assignCoverageCandidate(
        context(second),
        await input(next.id, "2026-11-22", "M"),
      );
      await waiting("valid-second", "valid-first");
    } finally {
      first.hold.release();
    }
    expect(await p1).toMatchObject({ ok: true });
    expect(await p2).toMatchObject({ ok: true });
  });

  it("coordinates the normal editor with Candidate without adding editor rule gates", async () => {
    const next = await nextSchedule();
    const first = connection(
      "editor-first",
      (s) => s.includes('from "users"') && s.includes("for share"),
    );
    const second = connection("candidate-second");
    const p1 = setAssignments(context(first), {
      scheduleId: next.id,
      expectedRevision: next.revision,
      changes: [{ nurseId: NURSE, date: "2026-11-22", shift: "M" }],
    });
    let p2: ReturnType<typeof assignCoverageCandidate> | undefined;
    try {
      await waitForBarrier(first);
      p2 = assignCoverageCandidate(
        context(second),
        await input(S, "2026-11-21", "N"),
      );
      await waiting("candidate-second", "editor-first");
    } finally {
      first.hold.release();
    }
    expect(await p1).toMatchObject({ ok: true });
    expect(await p2).toMatchObject({
      ok: false,
      error: { code: "RULE_VIOLATION" },
    });
  });

  it("protects against the first write to a neighbour created after lock-set discovery", async () => {
    const first = connection("missing-first", adjacentRead);
    const second = connection("new-neighbour");
    const p1 = assignCoverageCandidate(
      context(first),
      await input(S, "2026-11-21", "N"),
    );
    let p2: ReturnType<typeof assignCoverageCandidate> | undefined;
    try {
      await waitForBarrier(first);
      const next = await nextSchedule();
      p2 = assignCoverageCandidate(
        context(second),
        await input(next.id, "2026-11-22", "M"),
      );
      await waiting("new-neighbour", "missing-first");
    } finally {
      first.hold.release();
    }
    expect(await p1).toMatchObject({ ok: true });
    expect(await p2).toMatchObject({
      ok: false,
      error: { code: "RULE_VIOLATION" },
    });
  });
});

const endInput = () => ({
  relationId: membershipId,
  expectedEndedOn: null,
  endedOn: "2026-10-24",
});
describe("protected dated membership eligibility", () => {
  it.each(["end", "transfer"])(
    "Candidate's eligibility lock makes membership %s wait through commit",
    async (operation) => {
      const candidate = connection("membership-candidate", eligibilityRead);
      const admin = connection("membership-admin");
      const p1 = assignCoverageCandidate(context(candidate), await input());
      let p2:
        | ReturnType<typeof endDepartmentMembership>
        | ReturnType<typeof transitionDepartmentMembership>
        | undefined;
      try {
        await waitForBarrier(candidate);
        p2 =
          operation === "end"
            ? endDepartmentMembership(context(admin), endInput())
            : transitionDepartmentMembership(context(admin), {
                relationId: membershipId,
                expectedEndedOn: null,
                departmentId: DEMO_ER.id,
                role: "NURSE",
                startedOn: "2026-10-25",
                endedOn: null,
              });
        await waiting("membership-admin", "membership-candidate");
      } finally {
        candidate.hold.release();
      }
      expect(await p1).toMatchObject({ ok: true });
      expect(await p2).toMatchObject({ ok: true });
      expect(
        (await listAssignments(db, S)).filter(
          (a) => a.nurseId === NURSE && a.date === "2026-10-25",
        ),
      ).toMatchObject([{ shift: "M" }]);
      const [member] = await db
        .select()
        .from(departmentMemberships)
        .where(eq(departmentMemberships.id, membershipId));
      expect(member!.endedOn).toBe("2026-10-24");
    },
  );

  it("rechecks the date predicate after waiting for membership end to commit", async () => {
    const admin = connection("ending-first", (s) =>
      s.startsWith('update "department_memberships"'),
    );
    const candidate = connection("eligibility-second");
    const before = await state();
    const p1 = endDepartmentMembership(context(admin), endInput());
    let p2: ReturnType<typeof assignCoverageCandidate> | undefined;
    try {
      await waitForBarrier(admin);
      p2 = assignCoverageCandidate(context(candidate), await input());
      await waiting("eligibility-second", "ending-first");
    } finally {
      admin.hold.release();
    }
    expect(await p1).toMatchObject({ ok: true });
    expect(await p2).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", reason: "NOT_A_CANDIDATE" },
    });
    expect(await state()).toEqual(before);
  });

  it("rejects an already committed end without assignment, audit or revision changes", async () => {
    const admin = connection("ended-admin");
    expect(
      await endDepartmentMembership(context(admin), endInput()),
    ).toMatchObject({ ok: true });
    const before = await state();
    const candidate = connection("ended-candidate");
    expect(
      await assignCoverageCandidate(context(candidate), await input()),
    ).toMatchObject({ ok: false, error: { reason: "NOT_A_CANDIDATE" } });
    expect(await state()).toEqual(before);
  });

  it("keeps end dates inclusive under the membership lock", async () => {
    const admin = connection("inclusive-admin");
    expect(
      await endDepartmentMembership(context(admin), {
        ...endInput(),
        endedOn: "2026-10-25",
      }),
    ).toMatchObject({ ok: true });
    const candidate = connection("inclusive-candidate");
    expect(
      await assignCoverageCandidate(context(candidate), await input()),
    ).toMatchObject({ ok: true });
  });

  it("rejects future membership under the locking query", async () => {
    await db
      .update(departmentMemberships)
      .set({ startedOn: "2026-10-26" })
      .where(eq(departmentMemberships.id, membershipId));
    const before = await state();
    const candidate = connection("future-candidate");
    expect(
      await assignCoverageCandidate(context(candidate), await input()),
    ).toMatchObject({ ok: false, error: { reason: "NOT_A_CANDIDATE" } });
    expect(await state()).toEqual(before);
  });
});

it("keeps write statements and locks bounded with 6 versus 60 roster members", async () => {
  const counts: number[] = [];
  for (const size of [6, 60]) {
    const current = (
      await pool.query<{ n: number }>(
        "select count(*)::int as n from schedule_roster where schedule_id = $1",
        [S],
      )
    ).rows[0]!.n;
    for (let i = current; i < size; i++) {
      const user = await createUser(db, {
        email: `concurrency-${i}@test.invalid`,
        displayName: `پرستار ${i}`,
      });
      await addMembership(db, {
        userId: user.id,
        departmentId: DEMO_ICU.id,
        role: "NURSE",
        startedOn: isoDate("2026-01-01"),
      });
      await addToRoster(db, {
        scheduleId: S,
        userId: user.id,
        role: "NURSE",
        addedBy: HEAD,
      });
    }
    const candidate = connection(`performance-${size}`);
    expect(
      await assignCoverageCandidate(
        context(candidate),
        await input(S, size === 6 ? "2026-10-25" : "2026-10-27"),
      ),
    ).toMatchObject({ ok: true });
    counts.push(candidate.statements.length);
    expect(
      candidate.statements.filter((s) =>
        s.includes('"department_memberships"'),
      ),
    ).toHaveLength(1);
  }
  expect(counts).toEqual([14, 14]); // old command: 13; one bounded schedule-discovery read added.
});
