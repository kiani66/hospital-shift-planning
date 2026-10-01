CREATE TYPE "public"."change_reason_scope" AS ENUM('REQUEST', 'ADJUSTMENT', 'BOTH');--> statement-breakpoint
CREATE TYPE "public"."change_request_rejection" AS ENUM('HEAD_NURSE', 'COUNTERPART_DECLINED');--> statement-breakpoint
CREATE TYPE "public"."change_request_status" AS ENUM('PENDING', 'CANCELLED', 'REJECTED', 'APPLIED');--> statement-breakpoint
CREATE TYPE "public"."change_request_type" AS ENUM('UNAVAILABLE', 'CHANGE_SHIFT', 'SWAP', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."schedule_change_kind" AS ENUM('REQUEST', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."swap_consent_status" AS ENUM('PENDING', 'ACCEPTED', 'DECLINED');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'SWAP_CONSENT_REQUESTED';--> statement-breakpoint
CREATE TABLE "change_reasons" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"scope" "change_reason_scope" NOT NULL,
	"requires_note" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "change_reasons_code_check" CHECK ("change_reasons"."code" ~ '^[A-Z][A-Z0-9_]*$'),
	CONSTRAINT "change_reasons_other_note_check" CHECK ("change_reasons"."code" <> 'OTHER' or "change_reasons"."requires_note")
);
--> statement-breakpoint
CREATE TABLE "schedule_change_cells" (
	"change_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"before_shift_code" text,
	"after_shift_code" text,
	CONSTRAINT "schedule_change_cells_change_id_user_id_date_pk" PRIMARY KEY("change_id","user_id","date"),
	CONSTRAINT "schedule_change_cells_changed_check" CHECK ("schedule_change_cells"."before_shift_code" is distinct from "schedule_change_cells"."after_shift_code")
);
--> statement-breakpoint
CREATE TABLE "schedule_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"kind" "schedule_change_kind" NOT NULL,
	"request_id" uuid,
	"revision_id" uuid,
	"reason_code" text NOT NULL,
	"note" text,
	"applied_by" uuid NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_changes_request_key" UNIQUE("request_id"),
	CONSTRAINT "schedule_changes_kind_check" CHECK (("schedule_changes"."kind" = 'REQUEST') = ("schedule_changes"."request_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "shift_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"version_id" uuid,
	"requester_id" uuid NOT NULL,
	"type" "change_request_type" NOT NULL,
	"date" date NOT NULL,
	"requester_shift_code" text NOT NULL,
	"target_shift_code" text,
	"counterpart_id" uuid,
	"counterpart_shift_code" text,
	"reason_code" text NOT NULL,
	"note" text,
	"status" "change_request_status" DEFAULT 'PENDING' NOT NULL,
	"consent_status" "swap_consent_status",
	"consent_at" timestamp with time zone,
	"consent_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"rejected_at" timestamp with time zone,
	"rejected_by" uuid,
	"rejection" "change_request_rejection",
	"rejection_note" text,
	"applied_at" timestamp with time zone,
	"applied_by" uuid,
	CONSTRAINT "shift_change_requests_type_check" CHECK (("shift_change_requests"."type" = 'CHANGE_SHIFT') = ("shift_change_requests"."target_shift_code" is not null)
        and ("shift_change_requests"."type" = 'SWAP') = ("shift_change_requests"."counterpart_id" is not null)
        and ("shift_change_requests"."type" = 'SWAP') = ("shift_change_requests"."consent_status" is not null)
        and ("shift_change_requests"."counterpart_id" is not null or "shift_change_requests"."counterpart_shift_code" is null)),
	CONSTRAINT "shift_change_requests_counterpart_check" CHECK ("shift_change_requests"."counterpart_id" is null or "shift_change_requests"."counterpart_id" <> "shift_change_requests"."requester_id"),
	CONSTRAINT "shift_change_requests_target_check" CHECK ("shift_change_requests"."target_shift_code" is null or "shift_change_requests"."target_shift_code" <> "shift_change_requests"."requester_shift_code"),
	CONSTRAINT "shift_change_requests_consent_check" CHECK (("shift_change_requests"."consent_at" is null) = ("shift_change_requests"."consent_status" is null or "shift_change_requests"."consent_status" = 'PENDING')
        and ("shift_change_requests"."consent_by" is null) = ("shift_change_requests"."consent_at" is null)
        and ("shift_change_requests"."consent_by" is null or "shift_change_requests"."consent_by" = "shift_change_requests"."counterpart_id")),
	CONSTRAINT "shift_change_requests_cancelled_check" CHECK (("shift_change_requests"."status" = 'CANCELLED') = ("shift_change_requests"."cancelled_at" is not null)
        and ("shift_change_requests"."cancelled_by" is null) = ("shift_change_requests"."cancelled_at" is null)
        and ("shift_change_requests"."cancelled_by" is null or "shift_change_requests"."cancelled_by" = "shift_change_requests"."requester_id")),
	CONSTRAINT "shift_change_requests_rejected_check" CHECK (("shift_change_requests"."status" = 'REJECTED') = ("shift_change_requests"."rejected_at" is not null)
        and ("shift_change_requests"."rejected_by" is null) = ("shift_change_requests"."rejected_at" is null)
        and ("shift_change_requests"."rejection" is null) = ("shift_change_requests"."rejected_at" is null)),
	CONSTRAINT "shift_change_requests_applied_check" CHECK (("shift_change_requests"."status" = 'APPLIED') = ("shift_change_requests"."applied_at" is not null)
        and ("shift_change_requests"."applied_by" is null) = ("shift_change_requests"."applied_at" is null))
);
--> statement-breakpoint
ALTER TABLE "schedule_change_cells" ADD CONSTRAINT "schedule_change_cells_change_id_schedule_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."schedule_changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_change_cells" ADD CONSTRAINT "schedule_change_cells_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_change_cells" ADD CONSTRAINT "schedule_change_cells_before_shift_code_shift_types_code_fk" FOREIGN KEY ("before_shift_code") REFERENCES "public"."shift_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_change_cells" ADD CONSTRAINT "schedule_change_cells_after_shift_code_shift_types_code_fk" FOREIGN KEY ("after_shift_code") REFERENCES "public"."shift_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_changes" ADD CONSTRAINT "schedule_changes_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_changes" ADD CONSTRAINT "schedule_changes_request_id_shift_change_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."shift_change_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_changes" ADD CONSTRAINT "schedule_changes_revision_id_schedule_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."schedule_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_changes" ADD CONSTRAINT "schedule_changes_reason_code_change_reasons_code_fk" FOREIGN KEY ("reason_code") REFERENCES "public"."change_reasons"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_changes" ADD CONSTRAINT "schedule_changes_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_version_id_schedule_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."schedule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_requester_shift_code_shift_types_code_fk" FOREIGN KEY ("requester_shift_code") REFERENCES "public"."shift_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_target_shift_code_shift_types_code_fk" FOREIGN KEY ("target_shift_code") REFERENCES "public"."shift_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_counterpart_id_users_id_fk" FOREIGN KEY ("counterpart_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_reason_code_change_reasons_code_fk" FOREIGN KEY ("reason_code") REFERENCES "public"."change_reasons"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_consent_by_users_id_fk" FOREIGN KEY ("consent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_roster_fk" FOREIGN KEY ("schedule_id","requester_id") REFERENCES "public"."schedule_roster"("schedule_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_counterpart_shift_fk" FOREIGN KEY ("counterpart_shift_code") REFERENCES "public"."shift_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_counterpart_roster_fk" FOREIGN KEY ("schedule_id","counterpart_id") REFERENCES "public"."schedule_roster"("schedule_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_changes_schedule_idx" ON "schedule_changes" USING btree ("schedule_id","applied_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_change_requests_one_active_key" ON "shift_change_requests" USING btree ("schedule_id","requester_id","date") WHERE "shift_change_requests"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "shift_change_requests_queue_idx" ON "shift_change_requests" USING btree ("schedule_id","status","created_at");--> statement-breakpoint
CREATE INDEX "shift_change_requests_requester_idx" ON "shift_change_requests" USING btree ("requester_id","created_at");--> statement-breakpoint
CREATE INDEX "shift_change_requests_counterpart_idx" ON "shift_change_requests" USING btree ("counterpart_id","created_at");