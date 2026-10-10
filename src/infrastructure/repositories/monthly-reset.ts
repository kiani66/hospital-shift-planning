import { sql } from "drizzle-orm";
import type { DbExecutor, Transaction } from "../db/database";

export interface MonthlyPlanningCounts {
  assignments: number;
  changes: number;
  changeCells: number;
  preferences: number;
  protectedHistory: number;
}
export async function readMonthlyPlanningCounts(
  db: DbExecutor,
  id: string,
): Promise<MonthlyPlanningCounts> {
  const result = await db.execute(sql`select
    (select count(*)::int from shift_assignments where schedule_id = ${id}) as assignments,
    (select count(*)::int from schedule_changes where schedule_id = ${id}) as changes,
    (select count(*)::int from schedule_change_cells c join schedule_changes s on s.id = c.change_id where s.schedule_id = ${id}) as "changeCells",
    (select count(*)::int from nurse_preferences where schedule_id = ${id}) as preferences,
    ((select count(*) from schedule_versions where schedule_id = ${id}) +
     (select count(*) from schedule_submissions where schedule_id = ${id}) +
     (select count(*) from schedule_revisions where schedule_id = ${id}) +
     (select count(*) from shift_change_requests where schedule_id = ${id}) +
     (select count(*) from legacy_shift_change_requests where schedule_id = ${id}) +
     (select count(*) from schedule_changes where schedule_id = ${id} and (revision_id is not null or request_id is not null)))::int as "protectedHistory"`);
  return result.rows[0] as unknown as MonthlyPlanningCounts;
}
/** After boundary schedule locks, protect current authorization through commit. */
export async function lockMonthlyResetAuthority(
  tx: Transaction,
  userId: string,
  departmentId: string,
) {
  await tx.execute(
    sql`select id from departments where id = ${departmentId} for share`,
  );
  await tx.execute(sql`select id from users where id = ${userId} for share`);
  await tx.execute(
    sql`select id from department_memberships where user_id = ${userId} and department_id = ${departmentId} order by id for share`,
  );
}
export async function clearMonthlyPlanning(
  tx: Transaction,
  id: string,
): Promise<void> {
  await tx.execute(
    sql`delete from schedule_change_cells where change_id in (select id from schedule_changes where schedule_id = ${id})`,
  );
  await tx.execute(sql`delete from schedule_changes where schedule_id = ${id}`);
  await tx.execute(
    sql`delete from shift_assignments where schedule_id = ${id}`,
  );
}
