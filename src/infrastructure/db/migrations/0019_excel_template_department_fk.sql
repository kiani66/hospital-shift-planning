DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'department_excel_templates_department_id_departments_id_fk'
			AND conrelid = 'public.department_excel_templates'::regclass
	) THEN
		ALTER TABLE "department_excel_templates" ADD CONSTRAINT "department_excel_templates_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
