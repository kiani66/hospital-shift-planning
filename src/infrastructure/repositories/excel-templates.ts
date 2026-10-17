import { and, asc, eq, gte, isNull, max, or, sql } from "drizzle-orm";

import type { MembershipRole } from "../../domain/authz/actor";
import type { ExcelTemplateMapping } from "../../domain/excel-export/template-mapping";
import type { IsoDate } from "../../domain/shared/dates";
import type { DbExecutor, Transaction } from "../db/database";
import {
  departmentExcelTemplates as templates,
  departmentMemberships,
  departments,
  scheduleRoster,
  users,
} from "../db/schema";

/** A template without its bytes (what lists and pages show). */
export interface ExcelTemplateRecord {
  readonly id: string;
  readonly departmentId: string;
  readonly version: number;
  readonly fileName: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly mapping: StoredTemplateMapping;
  readonly revision: number;
  readonly uploadedBy: string;
  /** null when the uploader's account no longer exists. */
  readonly uploadedByName: string | null;
  readonly uploadedAt: Date;
  readonly mappingUpdatedAt: Date | null;
}

export interface ExcelTemplateWithContent extends ExcelTemplateRecord {
  readonly content: Uint8Array;
}

const uploader = sql<
  string | null
>`(select ${users.displayName} from ${users} where ${users.id} = ${templates.uploadedBy})`;

const metadata = {
  id: templates.id,
  departmentId: templates.departmentId,
  version: templates.version,
  fileName: templates.fileName,
  byteSize: templates.byteSize,
  sha256: templates.sha256,
  sheetName: templates.sheetName,
  personnelColumn: templates.personnelColumn,
  firstRow: templates.firstRow,
  lastRow: templates.lastRow,
  firstDayColumn: templates.firstDayColumn,
  dayHeaderRow: templates.dayHeaderRow,
  statisticColumns: templates.statisticColumns,
  summaryRows: templates.summaryRows,
  weekdayRow: templates.weekdayRow,
  weekdayFormat: templates.weekdayFormat,
  monthHeadingCell: templates.monthHeadingCell,
  holidayFillCell: templates.holidayFillCell,
  normalFillColumn: templates.normalFillColumn,
  revision: templates.revision,
  uploadedBy: templates.uploadedBy,
  uploadedByName: uploader,
  uploadedAt: templates.uploadedAt,
  mappingUpdatedAt: templates.mappingUpdatedAt,
};

/** A stored mapping: every optional part present (empty when unused). */
export type StoredTemplateMapping = Required<ExcelTemplateMapping>;

interface MetadataRow extends StoredTemplateMapping {
  readonly id: string;
  readonly departmentId: string;
  readonly version: number;
  readonly fileName: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly revision: number;
  readonly uploadedBy: string;
  readonly uploadedByName: string | null;
  readonly uploadedAt: Date;
  readonly mappingUpdatedAt: Date | null;
}

const toRecord = (row: MetadataRow): ExcelTemplateRecord => ({
  id: row.id,
  departmentId: row.departmentId,
  version: row.version,
  fileName: row.fileName,
  byteSize: row.byteSize,
  sha256: row.sha256,
  mapping: {
    sheetName: row.sheetName,
    personnelColumn: row.personnelColumn,
    firstRow: row.firstRow,
    lastRow: row.lastRow,
    firstDayColumn: row.firstDayColumn,
    dayHeaderRow: row.dayHeaderRow,
    statisticColumns: row.statisticColumns,
    summaryRows: row.summaryRows,
    weekdayRow: row.weekdayRow,
    weekdayFormat: row.weekdayFormat,
    monthHeadingCell: row.monthHeadingCell,
    holidayFillCell: row.holidayFillCell,
    normalFillColumn: row.normalFillColumn,
  },
  revision: row.revision,
  uploadedBy: row.uploadedBy,
  uploadedByName: row.uploadedByName,
  uploadedAt: row.uploadedAt,
  mappingUpdatedAt: row.mappingUpdatedAt,
});

/** The department's active template (metadata only), if any. */
export async function findActiveTemplate(
  db: DbExecutor,
  departmentId: string,
): Promise<ExcelTemplateRecord | null> {
  const [row] = await db
    .select(metadata)
    .from(templates)
    .where(
      and(
        eq(templates.departmentId, departmentId),
        eq(templates.isActive, true),
      ),
    );
  return row ? toRecord(row) : null;
}

/** The department's active template with its bytes, if any. */
export async function findActiveTemplateWithContent(
  db: DbExecutor,
  departmentId: string,
): Promise<ExcelTemplateWithContent | null> {
  const [row] = await db
    .select({ ...metadata, content: templates.content })
    .from(templates)
    .where(
      and(
        eq(templates.departmentId, departmentId),
        eq(templates.isActive, true),
      ),
    );
  return row ? { ...toRecord(row), content: row.content } : null;
}

/** Whether the department has an active template (no bytes are read). */
export async function hasActiveTemplate(
  db: DbExecutor,
  departmentId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: templates.id })
    .from(templates)
    .where(
      and(
        eq(templates.departmentId, departmentId),
        eq(templates.isActive, true),
      ),
    );
  return row !== undefined;
}

/**
 * Locks the department row (`FOR NO KEY UPDATE`) for the rest of the
 * transaction, so template writes of one department run one at a time.
 * Foreign-key checks elsewhere (`FOR KEY SHARE`) are not blocked.
 */
export async function lockDepartmentForTemplate(
  tx: Transaction,
  departmentId: string,
): Promise<{ id: string; isActive: boolean } | null> {
  const [row] = await tx
    .select({ id: departments.id, isActive: departments.isActive })
    .from(departments)
    .where(eq(departments.id, departmentId))
    .for("no key update");
  return row ?? null;
}

/** Deactivates the active template and inserts the new one as active. */
export async function replaceActiveTemplate(
  tx: Transaction,
  input: {
    departmentId: string;
    fileName: string;
    content: Uint8Array;
    sha256: string;
    mapping: StoredTemplateMapping;
    uploadedBy: string;
  },
): Promise<{ id: string; version: number }> {
  await tx
    .update(templates)
    .set({ isActive: false })
    .where(
      and(
        eq(templates.departmentId, input.departmentId),
        eq(templates.isActive, true),
      ),
    );
  const [latest] = await tx
    .select({ version: max(templates.version) })
    .from(templates)
    .where(eq(templates.departmentId, input.departmentId));
  const [row] = await tx
    .insert(templates)
    .values({
      departmentId: input.departmentId,
      version: (latest?.version ?? 0) + 1,
      isActive: true,
      fileName: input.fileName,
      byteSize: input.content.byteLength,
      sha256: input.sha256,
      content: input.content,
      ...input.mapping,
      uploadedBy: input.uploadedBy,
    })
    .returning({ id: templates.id, version: templates.version });
  return row!;
}

/** Saves a new mapping on an existing template; bumps its revision. */
export async function updateTemplateMapping(
  tx: Transaction,
  input: {
    id: string;
    expectedRevision: number;
    mapping: StoredTemplateMapping;
    updatedBy: string;
    now: Date;
  },
): Promise<number | null> {
  const [row] = await tx
    .update(templates)
    .set({
      ...input.mapping,
      revision: sql`${templates.revision} + 1`,
      mappingUpdatedBy: input.updatedBy,
      mappingUpdatedAt: input.now,
    })
    .where(
      and(
        eq(templates.id, input.id),
        eq(templates.isActive, true),
        eq(templates.revision, input.expectedRevision),
      ),
    )
    .returning({ revision: templates.revision });
  return row?.revision ?? null;
}

/** Every active department with its active template (metadata only), by code. */
export async function listDepartmentTemplates(db: DbExecutor): Promise<
  {
    readonly department: { id: string; code: string; name: string };
    readonly template: ExcelTemplateRecord | null;
  }[]
> {
  const rows = await db
    .select({
      department: {
        id: departments.id,
        code: departments.code,
        name: departments.name,
      },
      template: metadata,
    })
    .from(departments)
    .leftJoin(
      templates,
      and(
        eq(templates.departmentId, departments.id),
        eq(templates.isActive, true),
      ),
    )
    .where(eq(departments.isActive, true))
    .orderBy(asc(departments.code));
  return rows.map(({ department, template }) => ({
    department,
    // Drizzle returns null for the joined object when no template matched.
    template: template?.id ? toRecord(template as MetadataRow) : null,
  }));
}

/** A roster member of a schedule as the exporter matches them. */
export interface ExportRosterEntry {
  readonly userId: string;
  readonly displayName: string;
  readonly role: MembershipRole;
  readonly personnelNumber: string | null;
  readonly isActive: boolean;
}

/** The complete schedule roster (the historical snapshot), with identities. */
export async function listExportRoster(
  db: DbExecutor,
  scheduleId: string,
): Promise<ExportRosterEntry[]> {
  return db
    .select({
      userId: scheduleRoster.userId,
      displayName: users.displayName,
      role: scheduleRoster.role,
      personnelNumber: users.personnelNumber,
      isActive: users.isActive,
    })
    .from(scheduleRoster)
    .innerJoin(users, eq(users.id, scheduleRoster.userId))
    .where(eq(scheduleRoster.scheduleId, scheduleId))
    .orderBy(asc(users.displayName), asc(scheduleRoster.userId));
}

/** A department member as a template row can be assigned to (D124). */
export interface TemplatePersonnelEntry {
  readonly userId: string;
  readonly displayName: string;
  readonly role: MembershipRole;
  /** The authoritative personnel number; null when none is recorded. */
  readonly personnelNumber: string | null;
}

/**
 * Members of the department whose membership has not ended before `onDate`
 * (current and future members, D19), with active accounts: the people a
 * template's personnel rows can belong to. One row per person.
 */
export async function listTemplatePersonnel(
  db: DbExecutor,
  departmentId: string,
  onDate: IsoDate,
): Promise<TemplatePersonnelEntry[]> {
  return db
    .selectDistinctOn([users.displayName, users.id], {
      userId: users.id,
      displayName: users.displayName,
      role: departmentMemberships.role,
      personnelNumber: users.personnelNumber,
    })
    .from(departmentMemberships)
    .innerJoin(users, eq(users.id, departmentMemberships.userId))
    .where(
      and(
        eq(departmentMemberships.departmentId, departmentId),
        eq(users.isActive, true),
        or(
          isNull(departmentMemberships.endedOn),
          gte(departmentMemberships.endedOn, onDate),
        ),
      ),
    )
    .orderBy(
      asc(users.displayName),
      asc(users.id),
      asc(departmentMemberships.startedOn),
    );
}
