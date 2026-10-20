CREATE TABLE "official_calendar_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "official_calendar_audit_events_action_check" CHECK ("official_calendar_audit_events"."action" in ('GENERATED','IMPORTED','CONFIRMED'))
);
--> statement-breakpoint
CREATE TABLE "official_calendar_version_days" (
	"version_id" uuid NOT NULL,
	"date" date NOT NULL,
	"is_friday" boolean NOT NULL,
	"official_status" text NOT NULL,
	"holiday_names" jsonb NOT NULL,
	CONSTRAINT "official_calendar_version_days_version_id_date_pk" PRIMARY KEY("version_id","date"),
	CONSTRAINT "official_calendar_version_days_status_check" CHECK ("official_calendar_version_days"."official_status" in ('UNKNOWN','NONE','OFFICIAL','PROVISIONAL')),
	CONSTRAINT "official_calendar_version_days_names_check" CHECK (jsonb_typeof("official_calendar_version_days"."holiday_names") = 'array' and (("official_calendar_version_days"."official_status" in ('UNKNOWN','NONE') and jsonb_array_length("official_calendar_version_days"."holiday_names") = 0) or ("official_calendar_version_days"."official_status" in ('OFFICIAL','PROVISIONAL') and jsonb_array_length("official_calendar_version_days"."holiday_names") > 0))),
	CONSTRAINT "official_calendar_version_days_friday_check" CHECK ("official_calendar_version_days"."is_friday" = (extract(dow from "official_calendar_version_days"."date") = 5))
);
--> statement-breakpoint
CREATE TABLE "official_calendar_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"version_no" integer NOT NULL,
	"based_on_version_id" uuid,
	"origin" text NOT NULL,
	"completeness" text NOT NULL,
	"source" jsonb,
	"reason" text NOT NULL,
	"created_by" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_by" jsonb,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "official_calendar_versions_year_id_key" UNIQUE("year","id"),
	CONSTRAINT "official_calendar_versions_no_check" CHECK ("official_calendar_versions"."version_no" >= 1),
	CONSTRAINT "official_calendar_versions_content_check" CHECK (("official_calendar_versions"."origin" = 'GENERATED' and "official_calendar_versions"."completeness" = 'UNKNOWN' and "official_calendar_versions"."source" is null) or ("official_calendar_versions"."origin" = 'IMPORT' and "official_calendar_versions"."completeness" in ('PARTIAL','COMPLETE') and "official_calendar_versions"."source" is not null)),
	CONSTRAINT "official_calendar_versions_confirmation_check" CHECK (("official_calendar_versions"."confirmed_at" is null) = ("official_calendar_versions"."confirmed_by" is null) and ("official_calendar_versions"."confirmed_at" is null or ("official_calendar_versions"."completeness" = 'COMPLETE' and "official_calendar_versions"."source"->>'verified' = 'true')))
);
--> statement-breakpoint
CREATE TABLE "official_calendar_years" (
	"year" integer PRIMARY KEY NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"confirmation_status" text DEFAULT 'UNCONFIRMED' NOT NULL,
	"active_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "official_calendar_years_year_check" CHECK ("official_calendar_years"."year" between 1300 and 1500),
	CONSTRAINT "official_calendar_years_period_check" CHECK ("official_calendar_years"."period_end" - "official_calendar_years"."period_start" in (364,365)),
	CONSTRAINT "official_calendar_years_confirmation_check" CHECK (("official_calendar_years"."confirmation_status" = 'UNCONFIRMED' and "official_calendar_years"."active_version_id" is null) or ("official_calendar_years"."confirmation_status" = 'CONFIRMED' and "official_calendar_years"."active_version_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "official_calendar_audit_events" ADD CONSTRAINT "official_calendar_audit_events_version_id_official_calendar_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."official_calendar_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_calendar_version_days" ADD CONSTRAINT "official_calendar_version_days_version_id_official_calendar_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."official_calendar_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_calendar_versions" ADD CONSTRAINT "official_calendar_versions_year_official_calendar_years_year_fk" FOREIGN KEY ("year") REFERENCES "public"."official_calendar_years"("year") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_calendar_versions" ADD CONSTRAINT "official_calendar_versions_base_fk" FOREIGN KEY ("year","based_on_version_id") REFERENCES "public"."official_calendar_versions"("year","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_calendar_years" ADD CONSTRAINT "official_calendar_years_active_version_fk" FOREIGN KEY ("year","active_version_id") REFERENCES "public"."official_calendar_versions"("year","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "official_calendar_versions_no_key" ON "official_calendar_versions" USING btree ("year","version_no");