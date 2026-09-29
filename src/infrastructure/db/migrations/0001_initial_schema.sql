CREATE TYPE "public"."assignment_source" AS ENUM('MANUAL', 'PREFILL');--> statement-breakpoint
CREATE TYPE "public"."change_request_status" AS ENUM('PENDING', 'ACKNOWLEDGED', 'DECLINED', 'RESOLVED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."date_scope_kind" AS ENUM('DAY', 'DAYS', 'RANGE', 'WEEK', 'PERIOD');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('NURSE', 'HEAD_NURSE');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('PREFERENCES_OPENED', 'DATES_REOPENED', 'SCHEDULE_FINALIZED', 'SCHEDULE_SUBMITTED', 'SCHEDULE_APPROVED', 'SCHEDULE_RETURNED', 'REVISION_STARTED', 'CHANGE_REQUEST_SUBMITTED', 'CHANGE_REQUEST_REVIEWED');--> statement-breakpoint
CREATE TYPE "public"."preference_value" AS ENUM('M', 'E', 'N', 'ME', 'OFF');--> statement-breakpoint
CREATE TYPE "public"."preference_window_kind" AS ENUM('INITIAL', 'REOPEN');--> statement-breakpoint
CREATE TYPE "public"."revision_status" AS ENUM('OPEN', 'APPROVED', 'DISCARDED');--> statement-breakpoint
CREATE TYPE "public"."schedule_status" AS ENUM('DRAFT', 'PLANNING', 'FINALIZED', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REVISING');--> statement-breakpoint
CREATE TYPE "public"."submission_decision" AS ENUM('APPROVED', 'RETURNED', 'WITHDRAWN');--> statement-breakpoint
CREATE TABLE "department_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "department_memberships_dates_check" CHECK ("department_memberships"."ended_on" is null or "department_memberships"."ended_on" >= "department_memberships"."started_on")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Tehran' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "supervisor_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supervisor_assignments_dates_check" CHECK ("supervisor_assignments"."ended_on" is null or "supervisor_assignments"."ended_on" >= "supervisor_assignments"."started_on")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_types" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"covers" text[] NOT NULL,
	"is_night" boolean NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nurse_preferences" (
	"schedule_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"value" "preference_value" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nurse_preferences_schedule_id_user_id_date_pk" PRIMARY KEY("schedule_id","user_id","date")
);
--> statement-breakpoint
CREATE TABLE "preference_window_dates" (
	"window_id" uuid NOT NULL,
	"date" date NOT NULL,
	CONSTRAINT "preference_window_dates_window_id_date_pk" PRIMARY KEY("window_id","date")
);
--> statement-breakpoint
CREATE TABLE "preference_window_nurses" (
	"window_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "preference_window_nurses_window_id_user_id_pk" PRIMARY KEY("window_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "preference_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"kind" "preference_window_kind" NOT NULL,
	"scope_kind" date_scope_kind NOT NULL,
	"reason" text,
	"opened_by" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closes_at" timestamp with time zone,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	CONSTRAINT "preference_windows_closed_check" CHECK (("preference_windows"."closed_by" is null) = ("preference_windows"."closed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "schedule_revision_dates" (
	"revision_id" uuid NOT NULL,
	"date" date NOT NULL,
	"added_by" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_revision_dates_revision_id_date_pk" PRIMARY KEY("revision_id","date")
);
--> statement-breakpoint
CREATE TABLE "schedule_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" "revision_status" DEFAULT 'OPEN' NOT NULL,
	"started_by" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "schedule_revisions_closed_check" CHECK (("schedule_revisions"."status" = 'OPEN') = ("schedule_revisions"."closed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "schedule_roster" (
	"schedule_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"added_by" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_roster_schedule_id_user_id_pk" PRIMARY KEY("schedule_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "schedule_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"revision_id" uuid,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"decision" "submission_decision",
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_comment" text,
	CONSTRAINT "schedule_submissions_decided_check" CHECK (("schedule_submissions"."decision" is null) = ("schedule_submissions"."decided_at" is null) and ("schedule_submissions"."decided_by" is null) = ("schedule_submissions"."decided_at" is null))
);
--> statement-breakpoint
CREATE TABLE "schedule_version_assignments" (
	"version_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"shift_code" text NOT NULL,
	CONSTRAINT "schedule_version_assignments_version_id_user_id_date_pk" PRIMARY KEY("version_id","user_id","date")
);
--> statement-breakpoint
CREATE TABLE "schedule_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"submission_id" uuid NOT NULL,
	"approved_by" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_versions_submissionId_unique" UNIQUE("submission_id"),
	CONSTRAINT "schedule_versions_schedule_version_key" UNIQUE("schedule_id","version_no"),
	CONSTRAINT "schedule_versions_version_no_check" CHECK ("schedule_versions"."version_no" >= 1)
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"label" text NOT NULL,
	"status" "schedule_status" DEFAULT 'DRAFT' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"current_version_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedules_department_period_key" UNIQUE("department_id","period_start"),
	CONSTRAINT "schedules_period_check" CHECK ("schedules"."period_end" >= "schedules"."period_start"),
	CONSTRAINT "schedules_revision_check" CHECK ("schedules"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shift_assignments" (
	"schedule_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"shift_code" text NOT NULL,
	"source" "assignment_source" DEFAULT 'MANUAL' NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_assignments_schedule_id_user_id_date_pk" PRIMARY KEY("schedule_id","user_id","date")
);
--> statement-breakpoint
CREATE TABLE "shift_change_request_items" (
	"request_id" uuid NOT NULL,
	"date" date NOT NULL,
	"current_shift_code" text,
	"desired_shift_code" text,
	CONSTRAINT "shift_change_request_items_request_id_date_pk" PRIMARY KEY("request_id","date")
);
--> statement-breakpoint
CREATE TABLE "shift_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"counterpart_user_id" uuid,
	"reason" text NOT NULL,
	"status" "change_request_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"resolved_revision_id" uuid,
	CONSTRAINT "shift_change_requests_counterpart_check" CHECK ("shift_change_requests"."counterpart_user_id" is null or "shift_change_requests"."counterpart_user_id" <> "shift_change_requests"."requester_id"),
	CONSTRAINT "shift_change_requests_reviewed_check" CHECK (("shift_change_requests"."reviewed_by" is null) = ("shift_change_requests"."reviewed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"schedule_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid NOT NULL,
	"department_id" uuid,
	"schedule_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text
);
--> statement-breakpoint
ALTER TABLE "department_memberships" ADD CONSTRAINT "department_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_memberships" ADD CONSTRAINT "department_memberships_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervisor_assignments" ADD CONSTRAINT "supervisor_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervisor_assignments" ADD CONSTRAINT "supervisor_assignments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nurse_preferences" ADD CONSTRAINT "nurse_preferences_roster_fk" FOREIGN KEY ("schedule_id","user_id") REFERENCES "public"."schedule_roster"("schedule_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preference_window_dates" ADD CONSTRAINT "preference_window_dates_window_id_preference_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."preference_windows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preference_window_nurses" ADD CONSTRAINT "preference_window_nurses_window_id_preference_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."preference_windows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preference_window_nurses" ADD CONSTRAINT "preference_window_nurses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preference_windows" ADD CONSTRAINT "preference_windows_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preference_windows" ADD CONSTRAINT "preference_windows_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preference_windows" ADD CONSTRAINT "preference_windows_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_revision_dates" ADD CONSTRAINT "schedule_revision_dates_revision_id_schedule_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."schedule_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_revision_dates" ADD CONSTRAINT "schedule_revision_dates_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_revisions" ADD CONSTRAINT "schedule_revisions_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_revisions" ADD CONSTRAINT "schedule_revisions_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_roster" ADD CONSTRAINT "schedule_roster_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_roster" ADD CONSTRAINT "schedule_roster_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_roster" ADD CONSTRAINT "schedule_roster_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_submissions" ADD CONSTRAINT "schedule_submissions_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_submissions" ADD CONSTRAINT "schedule_submissions_revision_id_schedule_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."schedule_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_submissions" ADD CONSTRAINT "schedule_submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_submissions" ADD CONSTRAINT "schedule_submissions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_version_assignments" ADD CONSTRAINT "schedule_version_assignments_version_id_schedule_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."schedule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_version_assignments" ADD CONSTRAINT "schedule_version_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_version_assignments" ADD CONSTRAINT "schedule_version_assignments_shift_code_shift_types_code_fk" FOREIGN KEY ("shift_code") REFERENCES "public"."shift_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_versions" ADD CONSTRAINT "schedule_versions_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_versions" ADD CONSTRAINT "schedule_versions_submission_id_schedule_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."schedule_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_versions" ADD CONSTRAINT "schedule_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_current_version_id_schedule_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."schedule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_shift_code_shift_types_code_fk" FOREIGN KEY ("shift_code") REFERENCES "public"."shift_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_roster_fk" FOREIGN KEY ("schedule_id","user_id") REFERENCES "public"."schedule_roster"("schedule_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_request_items" ADD CONSTRAINT "shift_change_request_items_request_id_shift_change_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."shift_change_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_request_items" ADD CONSTRAINT "shift_change_request_items_current_shift_code_shift_types_code_fk" FOREIGN KEY ("current_shift_code") REFERENCES "public"."shift_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_request_items" ADD CONSTRAINT "shift_change_request_items_desired_shift_code_shift_types_code_fk" FOREIGN KEY ("desired_shift_code") REFERENCES "public"."shift_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_counterpart_user_id_users_id_fk" FOREIGN KEY ("counterpart_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_resolved_revision_id_schedule_revisions_id_fk" FOREIGN KEY ("resolved_revision_id") REFERENCES "public"."schedule_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_roster_fk" FOREIGN KEY ("schedule_id","requester_id") REFERENCES "public"."schedule_roster"("schedule_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "department_memberships_active_key" ON "department_memberships" USING btree ("user_id","department_id") WHERE "department_memberships"."ended_on" is null;--> statement-breakpoint
CREATE INDEX "department_memberships_department_idx" ON "department_memberships" USING btree ("department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supervisor_assignments_active_key" ON "supervisor_assignments" USING btree ("user_id","department_id") WHERE "supervisor_assignments"."ended_on" is null;--> statement-breakpoint
CREATE INDEX "supervisor_assignments_department_idx" ON "supervisor_assignments" USING btree ("department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "preference_windows_schedule_idx" ON "preference_windows" USING btree ("schedule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_revisions_one_open_key" ON "schedule_revisions" USING btree ("schedule_id") WHERE "schedule_revisions"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "schedule_roster_user_idx" ON "schedule_roster" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_submissions_one_pending_key" ON "schedule_submissions" USING btree ("schedule_id") WHERE "schedule_submissions"."decision" is null;--> statement-breakpoint
CREATE INDEX "schedule_version_assignments_user_date_idx" ON "schedule_version_assignments" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "shift_assignments_user_date_idx" ON "shift_assignments" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "shift_change_requests_schedule_idx" ON "shift_change_requests" USING btree ("schedule_id","status");--> statement-breakpoint
CREATE INDEX "shift_change_requests_requester_idx" ON "shift_change_requests" USING btree ("requester_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_schedule_idx" ON "audit_events" USING btree ("schedule_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_department_idx" ON "audit_events" USING btree ("department_id","occurred_at");