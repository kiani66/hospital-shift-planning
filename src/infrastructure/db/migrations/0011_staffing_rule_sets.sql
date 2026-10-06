-- Versioned staffing/coverage rule sets (D105–D110). Additive (expand step):
-- * New tables for rule-set lineages, versions, day-type bounds, date exceptions and
--   the append-only history of Apply operations.
-- * Creates ONLY the Hospital Default lineage and its legacy baseline v1, which is
--   exactly the behaviour Production had before this release: M/E/N min 1, no max
--   (previously hard-coded). No other rule set is created here; in particular the
--   NICU 3–6 pilot rule is published through the rule-set workflow, never by a migration.
-- * Pins every existing schedule and approved version to the baseline (column
--   DEFAULT), so nothing about existing or historical validation changes and the
--   previous deployment's inserts keep working during the release. Dropping the
--   defaults is a later, separate contract step (docs/database.md).
-- * Does not bump schedules.revision and touches no assignment.
CREATE TYPE "public"."coverage_period" AS ENUM('M', 'E', 'N');--> statement-breakpoint
CREATE TYPE "public"."staffing_day_type" AS ENUM('NORMAL', 'HOLIDAY');--> statement-breakpoint
CREATE TYPE "public"."staffing_rule_set_retire_reason" AS ENUM('REPLACED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."staffing_rule_set_status" AS ENUM('DRAFT', 'PUBLISHED', 'RETIRED');--> statement-breakpoint
CREATE TABLE "staffing_rule_set_date_exceptions" (
	"version_id" uuid NOT NULL,
	"date" date NOT NULL,
	"coverage_period" "coverage_period" NOT NULL,
	"min_staff" integer NOT NULL,
	"max_staff" integer,
	"note" text,
	CONSTRAINT "staffing_rule_set_date_exceptions_version_id_date_coverage_period_pk" PRIMARY KEY("version_id","date","coverage_period"),
	CONSTRAINT "staffing_rule_set_date_exceptions_bounds_check" CHECK ("staffing_rule_set_date_exceptions"."min_staff" between 0 and 99 and ("staffing_rule_set_date_exceptions"."max_staff" is null or "staffing_rule_set_date_exceptions"."max_staff" between "staffing_rule_set_date_exceptions"."min_staff" and 99))
);
--> statement-breakpoint
CREATE TABLE "staffing_rule_set_requirements" (
	"version_id" uuid NOT NULL,
	"day_type" "staffing_day_type" NOT NULL,
	"coverage_period" "coverage_period" NOT NULL,
	"min_staff" integer NOT NULL,
	"max_staff" integer,
	CONSTRAINT "staffing_rule_set_requirements_version_id_day_type_coverage_period_pk" PRIMARY KEY("version_id","day_type","coverage_period"),
	CONSTRAINT "staffing_rule_set_requirements_bounds_check" CHECK ("staffing_rule_set_requirements"."min_staff" between 0 and 99 and ("staffing_rule_set_requirements"."max_staff" is null or "staffing_rule_set_requirements"."max_staff" between "staffing_rule_set_requirements"."min_staff" and 99))
);
--> statement-breakpoint
CREATE TABLE "staffing_rule_set_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"status" "staffing_rule_set_status" DEFAULT 'DRAFT' NOT NULL,
	"effective_from" date,
	"based_on_version_id" uuid,
	"note" text,
	"origin" text DEFAULT 'USER' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"retired_by" uuid,
	"retired_at" timestamp with time zone,
	"retired_reason" "staffing_rule_set_retire_reason",
	"replaced_by_version_id" uuid,
	CONSTRAINT "staffing_rule_set_versions_no_check" CHECK ("staffing_rule_set_versions"."version_no" >= 1),
	CONSTRAINT "staffing_rule_set_versions_revision_check" CHECK ("staffing_rule_set_versions"."revision" >= 0),
	CONSTRAINT "staffing_rule_set_versions_origin_check" CHECK ("staffing_rule_set_versions"."origin" in ('USER', 'MIGRATION')),
	CONSTRAINT "staffing_rule_set_versions_effective_check" CHECK (("staffing_rule_set_versions"."status" = 'DRAFT') = ("staffing_rule_set_versions"."effective_from" is null)),
	CONSTRAINT "staffing_rule_set_versions_published_check" CHECK (("staffing_rule_set_versions"."status" = 'DRAFT') = ("staffing_rule_set_versions"."published_at" is null)),
	CONSTRAINT "staffing_rule_set_versions_retired_check" CHECK (("staffing_rule_set_versions"."status" = 'RETIRED') = ("staffing_rule_set_versions"."retired_at" is not null) and ("staffing_rule_set_versions"."retired_at" is null) = ("staffing_rule_set_versions"."retired_reason" is null)),
	CONSTRAINT "staffing_rule_set_versions_actor_check" CHECK ("staffing_rule_set_versions"."origin" = 'MIGRATION' or ("staffing_rule_set_versions"."created_by" is not null and ("staffing_rule_set_versions"."status" = 'DRAFT' or "staffing_rule_set_versions"."published_by" is not null)))
);
--> statement-breakpoint
CREATE TABLE "staffing_rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_rule_set_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"from_version_id" uuid NOT NULL,
	"to_version_id" uuid NOT NULL,
	"revision_id" uuid,
	"rollback" boolean DEFAULT false NOT NULL,
	"applied_by" uuid NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"impact" jsonb NOT NULL,
	CONSTRAINT "schedule_rule_set_applications_change_check" CHECK ("schedule_rule_set_applications"."from_version_id" <> "schedule_rule_set_applications"."to_version_id")
);
--> statement-breakpoint
ALTER TABLE "schedule_versions" ADD COLUMN "staffing_rule_set_version_id" uuid DEFAULT '5ca1ab1e-0000-4000-8000-000000000002' NOT NULL;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "staffing_rule_set_version_id" uuid DEFAULT '5ca1ab1e-0000-4000-8000-000000000002' NOT NULL;--> statement-breakpoint
ALTER TABLE "staffing_rule_set_date_exceptions" ADD CONSTRAINT "staffing_rule_set_date_exceptions_version_id_staffing_rule_set_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."staffing_rule_set_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_rule_set_requirements" ADD CONSTRAINT "staffing_rule_set_requirements_version_id_staffing_rule_set_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."staffing_rule_set_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_rule_set_versions" ADD CONSTRAINT "staffing_rule_set_versions_rule_set_id_staffing_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."staffing_rule_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_rule_set_versions" ADD CONSTRAINT "staffing_rule_set_versions_based_on_version_id_staffing_rule_set_versions_id_fk" FOREIGN KEY ("based_on_version_id") REFERENCES "public"."staffing_rule_set_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_rule_set_versions" ADD CONSTRAINT "staffing_rule_set_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_rule_set_versions" ADD CONSTRAINT "staffing_rule_set_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_rule_set_versions" ADD CONSTRAINT "staffing_rule_set_versions_retired_by_users_id_fk" FOREIGN KEY ("retired_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_rule_set_versions" ADD CONSTRAINT "staffing_rule_set_versions_replaced_by_version_id_staffing_rule_set_versions_id_fk" FOREIGN KEY ("replaced_by_version_id") REFERENCES "public"."staffing_rule_set_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_rule_sets" ADD CONSTRAINT "staffing_rule_sets_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_rule_set_applications" ADD CONSTRAINT "schedule_rule_set_applications_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_rule_set_applications" ADD CONSTRAINT "schedule_rule_set_applications_from_version_id_staffing_rule_set_versions_id_fk" FOREIGN KEY ("from_version_id") REFERENCES "public"."staffing_rule_set_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_rule_set_applications" ADD CONSTRAINT "schedule_rule_set_applications_to_version_id_staffing_rule_set_versions_id_fk" FOREIGN KEY ("to_version_id") REFERENCES "public"."staffing_rule_set_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_rule_set_applications" ADD CONSTRAINT "schedule_rule_set_applications_revision_id_schedule_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."schedule_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_rule_set_applications" ADD CONSTRAINT "schedule_rule_set_applications_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staffing_rule_set_date_exceptions_date_idx" ON "staffing_rule_set_date_exceptions" USING btree ("version_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "staffing_rule_set_versions_no_key" ON "staffing_rule_set_versions" USING btree ("rule_set_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "staffing_rule_set_versions_effective_key" ON "staffing_rule_set_versions" USING btree ("rule_set_id","effective_from") WHERE "staffing_rule_set_versions"."status" = 'PUBLISHED';--> statement-breakpoint
CREATE UNIQUE INDEX "staffing_rule_set_versions_one_draft_key" ON "staffing_rule_set_versions" USING btree ("rule_set_id") WHERE "staffing_rule_set_versions"."status" = 'DRAFT';--> statement-breakpoint
CREATE UNIQUE INDEX "staffing_rule_sets_department_key" ON "staffing_rule_sets" USING btree ("department_id") WHERE "staffing_rule_sets"."department_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "staffing_rule_sets_hospital_key" ON "staffing_rule_sets" USING btree (("department_id" is null)) WHERE "staffing_rule_sets"."department_id" is null;--> statement-breakpoint
CREATE INDEX "schedule_rule_set_applications_schedule_idx" ON "schedule_rule_set_applications" USING btree ("schedule_id","applied_at");--> statement-breakpoint
-- Hospital Default lineage and legacy baseline v1 (fixed ids, see schema/staffing-rules.ts).
INSERT INTO "staffing_rule_sets" ("id", "department_id")
VALUES ('5ca1ab1e-0000-4000-8000-000000000001', NULL);--> statement-breakpoint
INSERT INTO "staffing_rule_set_versions"
  ("id", "rule_set_id", "version_no", "status", "effective_from", "note", "origin", "published_at")
VALUES ('5ca1ab1e-0000-4000-8000-000000000002', '5ca1ab1e-0000-4000-8000-000000000001', 1,
  'PUBLISHED', '1900-01-01', 'Legacy baseline: the staffing rule in force before versioned rule sets', 'MIGRATION', now());--> statement-breakpoint
INSERT INTO "staffing_rule_set_requirements" ("version_id", "day_type", "coverage_period", "min_staff", "max_staff")
VALUES
  ('5ca1ab1e-0000-4000-8000-000000000002', 'NORMAL', 'M', 1, NULL),
  ('5ca1ab1e-0000-4000-8000-000000000002', 'NORMAL', 'E', 1, NULL),
  ('5ca1ab1e-0000-4000-8000-000000000002', 'NORMAL', 'N', 1, NULL);--> statement-breakpoint
ALTER TABLE "schedule_versions" ADD CONSTRAINT "schedule_versions_staffing_rule_set_version_id_staffing_rule_set_versions_id_fk" FOREIGN KEY ("staffing_rule_set_version_id") REFERENCES "public"."staffing_rule_set_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_staffing_rule_set_version_id_staffing_rule_set_versions_id_fk" FOREIGN KEY ("staffing_rule_set_version_id") REFERENCES "public"."staffing_rule_set_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");