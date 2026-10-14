CREATE TABLE "department_excel_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"is_active" boolean NOT NULL,
	"file_name" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"content" "bytea" NOT NULL,
	"sheet_name" text NOT NULL,
	"personnel_column" text NOT NULL,
	"first_row" integer NOT NULL,
	"last_row" integer NOT NULL,
	"first_day_column" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mapping_updated_by" uuid,
	"mapping_updated_at" timestamp with time zone,
	CONSTRAINT "department_excel_templates_version_key" UNIQUE("department_id","version"),
	CONSTRAINT "department_excel_templates_size_check" CHECK ("department_excel_templates"."byte_size" > 0 and "department_excel_templates"."byte_size" = octet_length("department_excel_templates"."content")),
	CONSTRAINT "department_excel_templates_rows_check" CHECK ("department_excel_templates"."first_row" >= 1 and "department_excel_templates"."last_row" >= "department_excel_templates"."first_row"),
	CONSTRAINT "department_excel_templates_columns_check" CHECK ("department_excel_templates"."personnel_column" ~ '^[A-Z]{1,3}$' and "department_excel_templates"."first_day_column" ~ '^[A-Z]{1,3}$')
);
--> statement-breakpoint
ALTER TABLE "department_excel_templates" ADD CONSTRAINT "department_excel_templates_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "department_excel_templates_one_active_key" ON "department_excel_templates" USING btree ("department_id") WHERE "department_excel_templates"."is_active";