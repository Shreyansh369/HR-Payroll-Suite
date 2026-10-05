CREATE TABLE "attendance_corrections" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"employee_id" text NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"entry_id" text
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "audit_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" text,
	"at" timestamp with time zone NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"summary" text NOT NULL,
	"doc" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"legal_name" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"parent_id" text
);
--> statement-breakpoint
CREATE TABLE "document_blobs" (
	"key" text PRIMARY KEY NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"employee_id" text,
	"category" text NOT NULL,
	"expiry_date" date,
	"visibility" text NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"employee_code" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"preferred_name" text,
	"email" text,
	"position" text,
	"status" text NOT NULL,
	"employment_type" text NOT NULL,
	"department_id" text,
	"manager_id" text,
	"work_location" text,
	"hire_date" date NOT NULL,
	"termination_date" date,
	"date_of_birth" date,
	"leave_policy_id" text,
	"user_id" text,
	CONSTRAINT "employees_status_valid" CHECK ("employees"."status" in ('onboarding', 'active', 'on_leave', 'terminated', 'archived')),
	CONSTRAINT "employees_type_valid" CHECK ("employees"."employment_type" in ('full_time', 'part_time', 'contract', 'temporary')),
	CONSTRAINT "employees_termination_after_hire" CHECK ("employees"."termination_date" is null or "employees"."termination_date" >= "employees"."hire_date")
);
--> statement-breakpoint
CREATE TABLE "employment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"employee_id" text NOT NULL,
	"effective_date" date NOT NULL,
	"type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"entity" text NOT NULL,
	"status" text NOT NULL,
	"file_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"employee_id" text NOT NULL,
	"leave_type_id" text NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"request_id" text
);
--> statement-breakpoint
CREATE TABLE "leave_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"employee_id" text NOT NULL,
	"leave_type_id" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "leave_requests_dates" CHECK ("leave_requests"."end_date" >= "leave_requests"."start_date"),
	CONSTRAINT "leave_requests_status_valid" CHECK ("leave_requests"."status" in ('pending', 'approved', 'rejected', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"active" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "licenses" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"plan" text NOT NULL,
	"status" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "licenses_plan_valid" CHECK ("licenses"."plan" in ('hosted', 'owned', 'none')),
	CONSTRAINT "licenses_status_valid" CHECK ("licenses"."status" in ('trialing', 'active', 'past_due', 'canceled', 'owned', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"employee_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"start_date" date NOT NULL,
	"reference" text,
	CONSTRAINT "loans_status_valid" CHECK ("loans"."status" in ('active', 'paid', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "organizations_kind_customer" CHECK ("organizations"."kind" = 'customer')
);
--> statement-breakpoint
CREATE TABLE "pay_items" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"employee_id" text NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"active" boolean NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	CONSTRAINT "pay_items_kind_valid" CHECK ("pay_items"."kind" in ('earning', 'deduction')),
	CONSTRAINT "pay_items_dates" CHECK ("pay_items"."end_date" is null or "pay_items"."end_date" >= "pay_items"."start_date")
);
--> statement-breakpoint
CREATE TABLE "pay_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"employee_id" text NOT NULL,
	"effective_from" date NOT NULL,
	"pay_type" text NOT NULL,
	"pay_frequency" text NOT NULL,
	CONSTRAINT "pay_rates_type_valid" CHECK ("pay_rates"."pay_type" in ('salary', 'hourly')),
	CONSTRAINT "pay_rates_frequency_valid" CHECK ("pay_rates"."pay_frequency" in ('weekly', 'biweekly', 'semi_monthly', 'monthly'))
);
--> statement-breakpoint
CREATE TABLE "payroll_results" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"run_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"pay_date" date NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"run_type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"pay_frequency" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"pay_date" date NOT NULL,
	"status" text NOT NULL,
	"corrects_run_id" text,
	CONSTRAINT "payroll_runs_period" CHECK ("payroll_runs"."period_end" >= "payroll_runs"."period_start"),
	CONSTRAINT "payroll_runs_type_valid" CHECK ("payroll_runs"."type" in ('regular', 'correction', 'off_cycle', 'historical')),
	CONSTRAINT "payroll_runs_status_valid" CHECK ("payroll_runs"."status" in ('draft', 'calculated', 'review', 'approved', 'finalized', 'locked'))
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "roles_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"company_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "statutory_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"code" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"jurisdiction" text,
	CONSTRAINT "statutory_rules_dates" CHECK ("statutory_rules"."effective_to" is null or "statutory_rules"."effective_to" >= "statutory_rules"."effective_from"),
	CONSTRAINT "statutory_rules_status_valid" CHECK ("statutory_rules"."status" in ('draft', 'approved', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timesheets" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"employee_id" text NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"absent" boolean
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"status" text NOT NULL,
	"password_hash" text,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "users_status_valid" CHECK ("users"."status" in ('active', 'disabled', 'invited'))
);
--> statement-breakpoint
CREATE TABLE "work_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"employee_id" text NOT NULL,
	"effective_from" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"employee_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"start_date" date
);
--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_events" ADD CONSTRAINT "employment_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_events" ADD CONSTRAINT "employment_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_items" ADD CONSTRAINT "pay_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_items" ADD CONSTRAINT "pay_items_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_rates" ADD CONSTRAINT "pay_rates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_rates" ADD CONSTRAINT "pay_rates_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_results" ADD CONSTRAINT "payroll_results_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_results" ADD CONSTRAINT "payroll_results_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_results" ADD CONSTRAINT "payroll_results_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_corrects_fk" FOREIGN KEY ("corrects_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_rules" ADD CONSTRAINT "statutory_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_corrections_idx" ON "attendance_corrections" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "audit_org_at_idx" ON "audit_events" USING btree ("organization_id","at");--> statement-breakpoint
CREATE INDEX "audit_company_at_idx" ON "audit_events" USING btree ("company_id","at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "companies_org_idx" ON "companies" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_code_unique" ON "departments" USING btree ("company_id",lower("code"));--> statement-breakpoint
CREATE INDEX "documents_emp_idx" ON "documents" USING btree ("company_id","employee_id");--> statement-breakpoint
CREATE INDEX "documents_expiry_idx" ON "documents" USING btree ("company_id","expiry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_code_unique" ON "employees" USING btree ("company_id",lower("employee_code"));--> statement-breakpoint
CREATE INDEX "employees_company_status_idx" ON "employees" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "employees_manager_idx" ON "employees" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "employment_events_emp_idx" ON "employment_events" USING btree ("company_id","employee_id","effective_date");--> statement-breakpoint
CREATE INDEX "leave_ledger_emp_idx" ON "leave_ledger" USING btree ("company_id","employee_id","leave_type_id","date");--> statement-breakpoint
CREATE INDEX "leave_requests_dates_idx" ON "leave_requests" USING btree ("company_id","start_date","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_code_unique" ON "leave_types" USING btree ("company_id",lower("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "licenses_org_unique" ON "licenses" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "licenses_stripe_customer_unique" ON "licenses" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "loans_emp_idx" ON "loans" USING btree ("company_id","employee_id");--> statement-breakpoint
CREATE INDEX "pay_items_emp_idx" ON "pay_items" USING btree ("company_id","employee_id");--> statement-breakpoint
CREATE INDEX "pay_rates_emp_idx" ON "pay_rates" USING btree ("company_id","employee_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_results_run_employee_unique" ON "payroll_results" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE INDEX "payroll_results_emp_idx" ON "payroll_results" USING btree ("company_id","employee_id","pay_date");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_regular_period_unique" ON "payroll_runs" USING btree ("company_id","pay_frequency","period_start","period_end") WHERE "payroll_runs"."type" = 'regular';--> statement-breakpoint
CREATE INDEX "payroll_runs_period_idx" ON "payroll_runs" USING btree ("company_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_org_key_unique" ON "roles" USING btree ("organization_id","key");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "statutory_rules_code_idx" ON "statutory_rules" USING btree ("company_id","code","effective_from");--> statement-breakpoint
CREATE INDEX "timesheets_emp_date_idx" ON "timesheets" USING btree ("company_id","employee_id","date");--> statement-breakpoint
CREATE INDEX "timesheets_date_idx" ON "timesheets" USING btree ("company_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "work_schedules_emp_idx" ON "work_schedules" USING btree ("company_id","employee_id","effective_from");--> statement-breakpoint
CREATE INDEX "workflows_idx" ON "workflows" USING btree ("company_id","status");