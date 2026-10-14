import { createHash } from "node:crypto";

import { z } from "zod";

import { decide } from "../../domain/authz/policies";
import {
  requireTemplateMapping,
  type ExcelTemplateMapping,
} from "../../domain/excel-export/template-mapping";
import { ValidationError } from "../../domain/shared/errors";
import { findDepartmentById } from "../../infrastructure/repositories/departments";
import {
  findActiveTemplate,
  findActiveTemplateWithContent,
  listDepartmentTemplates,
  lockDepartmentForTemplate,
  replaceActiveTemplate,
  updateTemplateMapping,
  type ExcelTemplateRecord,
} from "../../infrastructure/repositories/excel-templates";
import { ConflictError, NotFoundError } from "../errors";
import { defineCommand, type AppContext } from "../use-case";
import {
  EXCEL_TEMPLATE_LIMITS,
  inspectExcelTemplate,
  type TemplateInspection,
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
});

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

/**
 * Checks a new file, or the stored one with a new mapping, without saving
 * anything: the mapping summary shown before activation.
 */
export async function previewExcelTemplate(
  ctx: AppContext,
  input: {
    departmentId: string;
    mapping: ExcelTemplateMapping;
    content?: Uint8Array;
  },
): Promise<TemplateInspection> {
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
  return inspectExcelTemplate(content, input.mapping);
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
    const stored = {
      sheetName: mapping.sheetName,
      personnelColumn: mapping.personnelColumn,
      firstRow: mapping.firstRow,
      lastRow: mapping.lastRow,
      firstDayColumn: mapping.firstDayColumn,
    };
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
    const stored = {
      sheetName: mapping.sheetName,
      personnelColumn: mapping.personnelColumn,
      firstRow: mapping.firstRow,
      lastRow: mapping.lastRow,
      firstDayColumn: mapping.firstDayColumn,
    };
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
