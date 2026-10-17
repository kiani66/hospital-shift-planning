import { createHash } from "node:crypto";

import { z } from "zod";

import { decide } from "../../domain/authz/policies";
import {
  DAILY_STATISTICS,
  PERSON_STATISTICS,
  requireTemplateMapping,
  storedTemplateMapping,
  type ExcelTemplateMapping,
} from "../../domain/excel-export/template-mapping";
import { ValidationError } from "../../domain/shared/errors";
import { APP_TIMEZONE, todayIn } from "../../infrastructure/auth/actor";
import { findDepartmentById } from "../../infrastructure/repositories/departments";
import {
  findActiveTemplate,
  findActiveTemplateWithContent,
  listDepartmentTemplates,
  listTemplatePersonnel,
  lockDepartmentForTemplate,
  replaceActiveTemplate,
  updateTemplateMapping,
  type ExcelTemplateRecord,
  type TemplatePersonnelEntry,
} from "../../infrastructure/repositories/excel-templates";
import { ConflictError, NotFoundError } from "../errors";
import { defineCommand, type AppContext } from "../use-case";
import {
  EXCEL_TEMPLATE_LIMITS,
  inspectExcelTemplate,
  templateRowLabels,
  writePersonnelColumn,
  type TemplateInspection,
  type TemplateIssue,
} from "./template-workbook";

/**
 * The department's Excel export template (D124): one active template per
 * department, stored in PostgreSQL with its mapping, managed by a Hospital
 * Admin or the department's Head Nurse (`excelTemplate.manage`). A new
 * upload is usable by the next export at once: no file system, build or
 * deployment is involved.
 */

export const templateMappingInput = z.object({
  sheetName: z.string().trim().min(1).max(64),
  personnelColumn: z.string().trim().min(1).max(8),
  firstRow: z.coerce.number().int(),
  lastRow: z.coerce.number().int(),
  firstDayColumn: z.string().trim().min(1).max(8),
  dayHeaderRow: z.coerce.number().int().nullable().default(null),
  statisticColumns: z
    .array(
      z.object({
        column: z.string().trim().min(1).max(8),
        statistic: z.enum(PERSON_STATISTICS),
      }),
    )
    .max(16)
    .default([]),
  summaryRows: z
    .array(
      z.object({
        row: z.coerce.number().int(),
        statistic: z.enum(DAILY_STATISTICS),
      }),
    )
    .max(16)
    .default([]),
});

export type { TemplatePersonnelEntry };

export interface DepartmentRef {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface ExcelTemplateSummary extends Omit<
  ExcelTemplateRecord,
  "sha256" | "uploadedBy"
> {
  /** The stored bytes checked against the stored mapping now. */
  readonly inspection: TemplateInspection;
}

export interface ExcelTemplateSettings {
  readonly department: DepartmentRef;
  readonly template: ExcelTemplateSummary | null;
}

/** The department if the actor may manage its template; else NotFound (no existence leak). */
async function managedDepartment(
  ctx: AppContext,
  departmentId: string,
): Promise<DepartmentRef> {
  const department = await findDepartmentById(ctx.db, departmentId);
  if (
    !department ||
    !department.isActive ||
    !decide(ctx.actor, "excelTemplate.manage", { departmentId }).allowed
  )
    throw new NotFoundError("Department");
  return { id: department.id, code: department.code, name: department.name };
}

/** A safe display/download name: the base name, printable, ending in .xlsx. */
export function templateFileName(raw: string): string {
  const base =
    raw
      .split(/[\\/]/)
      .pop()!
      // Control and bidi-override characters never reach a header or the page.
      .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩"]/g, "")
      .trim()
      .slice(0, 120) || "template.xlsx";
  return /\.xlsx$/i.test(base) ? base : `${base}.xlsx`;
}

const inspectStored = (
  record: ExcelTemplateRecord & { content: Uint8Array },
): TemplateInspection => {
  try {
    return inspectExcelTemplate(record.content, record.mapping);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return {
      valid: false,
      mapping: null,
      sheetNames: [],
      errors: [{ message: error.message }],
      warnings: [],
      personnel: [],
      personnelRange: null,
      dayRange: null,
      personnelColumnHidden: false,
      printArea: null,
    };
  }
};

/** The settings section: the active template (metadata and current status) or none. */
export async function getExcelTemplateSettings(
  ctx: AppContext,
  input: { departmentId: string },
): Promise<ExcelTemplateSettings> {
  const department = await managedDepartment(ctx, input.departmentId);
  const record = await findActiveTemplateWithContent(ctx.db, department.id);
  if (!record) return { department, template: null };
  return {
    department,
    template: {
      id: record.id,
      departmentId: record.departmentId,
      version: record.version,
      fileName: record.fileName,
      byteSize: record.byteSize,
      mapping: record.mapping,
      revision: record.revision,
      uploadedByName: record.uploadedByName,
      uploadedAt: record.uploadedAt,
      mappingUpdatedAt: record.mappingUpdatedAt,
      inspection: inspectStored(record),
    },
  };
}

/** A matched template row with the system's own record of that personnel number. */
export interface TemplatePersonMatch {
  readonly cell: string;
  readonly personnelNumber: string;
  /** null: no current member of the department has this number. */
  readonly displayName: string | null;
}

export interface TemplatePreview extends TemplateInspection {
  /** Every matched row checked against the department's personnel records. */
  readonly matches: readonly TemplatePersonMatch[];
}

const personnelOf = (ctx: AppContext, departmentId: string) =>
  listTemplatePersonnel(
    ctx.db,
    departmentId,
    todayIn(APP_TIMEZONE, ctx.clock?.()),
  );

/**
 * Checks a new file, or the stored one with a new mapping, without saving
 * anything: the mapping summary shown before activation. Each personnel
 * number found is shown with the name the system records for it, so a
 * mistyped or misplaced number is seen before the template is used; a
 * number no member of the department has is a warning.
 */
export async function previewExcelTemplate(
  ctx: AppContext,
  input: {
    departmentId: string;
    mapping: ExcelTemplateMapping;
    content?: Uint8Array;
  },
): Promise<TemplatePreview> {
  const department = await managedDepartment(ctx, input.departmentId);
  const content =
    input.content ??
    (await findActiveTemplateWithContent(ctx.db, department.id))?.content;
  if (!content)
    throw new ValidationError(
      "ابتدا فایل قالب Excel را انتخاب کنید.",
      "file",
      "EXCEL_TEMPLATE_MISSING",
    );
  const inspection = inspectExcelTemplate(content, input.mapping);
  const byNumber = new Map(
    (await personnelOf(ctx, department.id))
      .filter((p) => p.personnelNumber)
      .map((p) => [p.personnelNumber!, p.displayName]),
  );
  const matches = inspection.personnel.map((p) => ({
    cell: p.cell,
    personnelNumber: p.personnelNumber,
    displayName: byNumber.get(p.personnelNumber) ?? null,
  }));
  const unknown: TemplateIssue[] = matches
    .filter((m) => m.displayName === null)
    .map((m) => ({
      cell: m.cell,
      message: `شماره پرسنلی ${m.personnelNumber} در ${m.cell} به هیچ عضو فعلی این بخش تعلق ندارد؛ شماره را بررسی کنید.`,
    }));
  return {
    ...inspection,
    warnings: [...inspection.warnings, ...unknown],
    matches,
  };
}

/**
 * The rows of an uploaded workbook (their printed text, for recognition
 * only) and the department's personnel, for choosing who each row belongs
 * to before the personnel-number column is written. Saves nothing.
 */
export async function describeTemplateRows(
  ctx: AppContext,
  input: {
    departmentId: string;
    content: Uint8Array;
    sheetName: string;
    firstRow: number;
    lastRow: number;
    firstDayColumn: string;
  },
): Promise<{
  rows: { row: number; label: string }[];
  personnel: TemplatePersonnelEntry[];
}> {
  const department = await managedDepartment(ctx, input.departmentId);
  return {
    rows: templateRowLabels(input.content, input),
    personnel: await personnelOf(ctx, department.id),
  };
}

/**
 * A copy of the uploaded workbook with each chosen row's personnel number
 * written into an empty column, which is hidden (D124). The numbers come
 * only from the system's records of the chosen people, never from the
 * workbook or from typed input, and never from names. Nothing is stored:
 * the person reviews the file and uploads it as the template.
 */
export async function prepareTemplatePersonnelColumn(
  ctx: AppContext,
  input: {
    departmentId: string;
    content: Uint8Array;
    sheetName: string;
    column: string;
    rows: readonly { row: number; userId: string }[];
  },
): Promise<Uint8Array> {
  const department = await managedDepartment(ctx, input.departmentId);
  const personnel = new Map(
    (await personnelOf(ctx, department.id)).map((p) => [p.userId, p]),
  );
  const invalid = (message: string): never => {
    throw new ValidationError(message, "rows", "EXCEL_TEMPLATE_PERSONNEL");
  };
  const numbers = new Map<number, string>();
  const chosen = new Set<string>();
  for (const { row, userId } of input.rows) {
    const person = personnel.get(userId);
    if (!person) invalid("فرد انتخاب‌شده عضو این بخش نیست.");
    if (chosen.has(userId))
      invalid(`«${person!.displayName}» برای بیش از یک ردیف انتخاب شده است.`);
    if (numbers.has(row)) invalid(`ردیف ${row} دو بار انتخاب شده است.`);
    if (!person!.personnelNumber)
      invalid(
        `برای «${person!.displayName}» شماره پرسنلی ثبت نشده است؛ ابتدا شماره را در پرونده پرسنلی ثبت کنید.`,
      );
    chosen.add(userId);
    numbers.set(row, person!.personnelNumber!);
  }
  return writePersonnelColumn(input.content, {
    sheetName: input.sheetName,
    column: input.column,
    numbers,
  });
}

/** The stored template file, unchanged, for download. */
export async function getExcelTemplateFile(
  ctx: AppContext,
  input: { departmentId: string },
): Promise<{ fileName: string; content: Uint8Array }> {
  const department = await managedDepartment(ctx, input.departmentId);
  const record = await findActiveTemplateWithContent(ctx.db, department.id);
  if (!record) throw new NotFoundError("ExcelTemplate");
  return { fileName: record.fileName, content: record.content };
}

/** Hospital Admin overview: every active department and its template, if any. */
export async function listExcelTemplateOverview(ctx: AppContext) {
  if (!ctx.actor.isActive || !ctx.actor.isHospitalAdmin)
    throw new NotFoundError("ExcelTemplates");
  return listDepartmentTemplates(ctx.db);
}

const invalidTemplate = (inspection: TemplateInspection): never => {
  const first = inspection.errors[0];
  throw new ValidationError(
    first ? `قالب معتبر نیست: ${first.message}` : "قالب معتبر نیست.",
    "file",
    "EXCEL_TEMPLATE_INVALID",
  );
};

/**
 * Uploads the department's first template or replaces the active one, in one
 * transaction: the department row is locked, the caller's view of the active
 * template is checked (a concurrent replacement gets CONFLICT), the file and
 * mapping are validated, then the old row is deactivated and the new one
 * inserted. Any failure leaves the working template active.
 */
export const uploadExcelTemplate = defineCommand({
  name: "excelTemplate.upload",
  input: z.object({
    departmentId: z.uuid(),
    /** The active template the user saw; null when they saw none. */
    expectedTemplateId: z.uuid().nullable(),
    fileName: z.string().min(1).max(512),
    content: z
      .instanceof(Uint8Array)
      .refine(
        (b) =>
          b.byteLength > 0 && b.byteLength <= EXCEL_TEMPLATE_LIMITS.maxBytes,
        "حجم فایل قالب حداکثر ۲ مگابایت است.",
      ),
    mapping: templateMappingInput,
  }),
  async handler(uow, input) {
    uow.authorize("excelTemplate.manage", { departmentId: input.departmentId });
    const department = await lockDepartmentForTemplate(
      uow.tx,
      input.departmentId,
    );
    if (!department?.isActive) throw new NotFoundError("Department");
    const current = await findActiveTemplate(uow.tx, input.departmentId);
    if ((current?.id ?? null) !== input.expectedTemplateId)
      throw new ConflictError(
        "Another template was saved meanwhile",
        "EXCEL_TEMPLATE_CHANGED",
      );
    const mapping = requireTemplateMapping(input.mapping);
    const inspection = inspectExcelTemplate(input.content, mapping);
    if (!inspection.valid) invalidTemplate(inspection);
    const sha256 = createHash("sha256").update(input.content).digest("hex");
    const fileName = templateFileName(input.fileName);
    const stored = storedTemplateMapping(mapping);
    const created = await replaceActiveTemplate(uow.tx, {
      departmentId: input.departmentId,
      fileName,
      content: input.content,
      sha256,
      mapping: stored,
      uploadedBy: uow.actor.userId,
    });
    await uow.audit({
      action: current ? "excelTemplate.replaced" : "excelTemplate.uploaded",
      entityType: "excelTemplate",
      entityId: created.id,
      departmentId: input.departmentId,
      data: {
        version: created.version,
        fileName,
        byteSize: input.content.byteLength,
        sha256,
        mapping: stored,
        personnel: inspection.personnel.length,
        replaced: current
          ? { templateId: current.id, version: current.version }
          : null,
      },
    });
    return { templateId: created.id, version: created.version };
  },
});

/** Saves a new mapping for the active template (the file itself is unchanged). */
export const updateExcelTemplateMapping = defineCommand({
  name: "excelTemplate.mappingUpdated",
  input: z.object({
    departmentId: z.uuid(),
    templateId: z.uuid(),
    expectedRevision: z.number().int().min(0),
    mapping: templateMappingInput,
  }),
  async handler(uow, input) {
    uow.authorize("excelTemplate.manage", { departmentId: input.departmentId });
    const department = await lockDepartmentForTemplate(
      uow.tx,
      input.departmentId,
    );
    if (!department?.isActive) throw new NotFoundError("Department");
    const current = await findActiveTemplateWithContent(
      uow.tx,
      input.departmentId,
    );
    if (
      !current ||
      current.id !== input.templateId ||
      current.revision !== input.expectedRevision
    )
      throw new ConflictError(
        "The template or its mapping changed meanwhile",
        "EXCEL_TEMPLATE_CHANGED",
      );
    const mapping = requireTemplateMapping(input.mapping);
    const inspection = inspectExcelTemplate(current.content, mapping);
    if (!inspection.valid) invalidTemplate(inspection);
    const stored = storedTemplateMapping(mapping);
    const revision = await updateTemplateMapping(uow.tx, {
      id: current.id,
      expectedRevision: input.expectedRevision,
      mapping: stored,
      updatedBy: uow.actor.userId,
      now: uow.now,
    });
    if (revision === null)
      throw new ConflictError(
        "The template or its mapping changed meanwhile",
        "EXCEL_TEMPLATE_CHANGED",
      );
    await uow.audit({
      action: "excelTemplate.mappingUpdated",
      entityType: "excelTemplate",
      entityId: current.id,
      departmentId: input.departmentId,
      data: {
        version: current.version,
        before: current.mapping,
        after: stored,
        personnel: inspection.personnel.length,
      },
    });
    return { templateId: current.id, revision };
  },
});
