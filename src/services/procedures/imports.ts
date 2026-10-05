import { z } from "zod";
import type { PayRate, Department, Employee, ImportBatch, ImportEntity, ImportRowError, LeaveLedgerEntry, Loan, PayItem, PayrollEmployeeResult, PayrollLine, PayrollRun, TimesheetEntry } from "@/domain/types";
import type { Permission } from "@/domain/auth/permissions";
import { IMPORT_DEFINITIONS, parseField, type DateOrder } from "@/domain/imports/definitions";
import { audit, companyToday, mutation, nowISO, query, type Ctx } from "@/services/core";
import { assertPermission } from "@/services/authz";
import { getCompany, displayName } from "@/services/helpers";
import { effectiveOn, isScheduledDay } from "@/domain/employee/schedule";
import { CALCULATION_VERSION, sumTotals } from "@/domain/payroll/engine";
import { money, sum } from "@/lib/money";
import { formatDate, formatRange } from "@/lib/dates";
import { conflict, validation } from "@/lib/errors";

const ENTITY_PERMISSION: Record<ImportEntity, Permission> = {
  employees: "employee.create",
  departments: "employee.edit",
  leave_balances: "leave.adjust",
  attendance: "attendance.edit",
  pay_components: "salary.edit",
  deductions: "salary.edit",
  loans: "salary.edit",
  historical_payroll: "payroll.create",
};

const MAX_ROWS = 5000;

const entity = z.enum(["employees", "departments", "leave_balances", "attendance", "pay_components", "deductions", "loans", "historical_payroll"]);
const inputSchema = z.object({
  entity,
  fileName: z.string().max(200).default("upload"),
  rows: z.array(z.record(z.string(), z.string())).max(MAX_ROWS),
  mapping: z.record(z.string(), z.string()),
  dateOrder: z.enum(["YMD", "DMY", "MDY"]).default("YMD"),
});

type Values = Record<string, string | number | boolean | null>;

export interface AnalyzedRow {
  row: number;
  status: "valid" | "error" | "duplicate";
  errors: ImportRowError[];
  values: Values;
  source: Record<string, string>;
}

async function analyze(ctx: Ctx, input: z.infer<typeof inputSchema>): Promise<{ rows: AnalyzedRow[]; notes: string[] }> {
  const def = IMPORT_DEFINITIONS[input.entity];
  const c = ctx.actor.companyId;
  const notes: string[] = [];
  const fieldToColumn = new Map<string, string>();
  for (const [col, key] of Object.entries(input.mapping)) if (key) fieldToColumn.set(key, col);

  const missingRequired = def.fields.filter((f) => f.required && !fieldToColumn.has(f.key) && !(input.entity === "employees" && (f.key === "firstName" || f.key === "lastName") && fieldToColumn.has("fullName")));
  if (missingRequired.length) throw validation(`Map a column to: ${missingRequired.map((f) => f.label).join(", ")}.`);

  const employees = await ctx.repo.employees.list(c);
  const byCode = new Map(employees.map((e) => [e.employeeCode.toUpperCase(), e]));
  const leaveTypes = input.entity === "leave_balances" ? await ctx.repo.leaveTypes.list(c) : [];
  const departments = input.entity === "departments" || input.entity === "employees" ? await ctx.repo.departments.list(c) : [];
  const existingTimesheets = input.entity === "attendance" ? await ctx.repo.timesheets.list(c) : [];
  const tsKeys = new Set(existingTimesheets.map((t) => `${t.employeeId}|${t.date}`));
  const seen = new Set<string>();
  const fileCodes = new Set<string>();
  if (input.entity === "employees") {
    const col = fieldToColumn.get("employeeCode");
    for (const r of input.rows) if (col && r[col]) fileCodes.add(r[col].trim().toUpperCase());
  }

  const out: AnalyzedRow[] = input.rows.map((source, i) => {
    const errors: ImportRowError[] = [];
    const values: Values = {};
    for (const f of def.fields) {
      const col = fieldToColumn.get(f.key);
      const required = f.required && !(input.entity === "employees" && (f.key === "firstName" || f.key === "lastName") && fieldToColumn.has("fullName"));
      const cell = parseField({ ...f, required }, col ? source[col] : undefined, input.dateOrder as DateOrder);
      if (cell.error) errors.push({ row: i + 2, field: f.label, message: cell.error });
      values[f.key] = cell.value;
    }
    let status: AnalyzedRow["status"] = "valid";
    const err = (message: string, field?: string) => errors.push({ row: i + 2, field, message });
    const empFor = () => {
      const code = String(values.employeeCode ?? "").toUpperCase();
      const e = byCode.get(code);
      if (code && !e) err(`Employee ID ${code} does not exist`, "Employee ID");
      return e;
    };

    switch (input.entity) {
      case "employees": {
        if (!values.firstName && !values.lastName && values.fullName) {
          const parts = String(values.fullName).split(/\s+/);
          values.firstName = parts.slice(0, -1).join(" ") || parts[0];
          values.lastName = parts.length > 1 ? parts[parts.length - 1] : "";
          if (!values.lastName) err("Full name must include a last name", "Full name");
        }
        const code = String(values.employeeCode ?? "").toUpperCase();
        if (code && !/^[A-Z0-9._-]+$/.test(code)) err("Employee ID may only contain letters, numbers, dot, dash or underscore", "Employee ID");
        if (code && byCode.has(code)) {
          status = "duplicate";
          err("Employee ID already exists", "Employee ID");
        } else if (code && seen.has(code)) {
          status = "duplicate";
          err("Employee ID appears more than once in this file", "Employee ID");
        }
        seen.add(code);
        if (values.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(values.email))) err("Email is not valid", "Email");
        if (values.managerCode) {
          const mc = String(values.managerCode).toUpperCase();
          if (!byCode.has(mc) && !fileCodes.has(mc)) err(`Manager ${mc} not found`, "Manager Employee ID");
          if (mc === code) err("An employee cannot be their own manager", "Manager Employee ID");
        }
        if (values.rateAmount !== null && values.rateAmount !== undefined) {
          if ((values.rateAmount as number) <= 0) err("Salary / rate must be greater than zero", "Salary / rate");
          if (!values.rateBasis) err("Rate basis is required when a salary / rate is given", "Rate basis");
          if (!values.payFrequency) err("Pay frequency is required when a salary / rate is given", "Pay frequency");
        }
        const dpw = values.daysPerWeek as number | null;
        if (dpw !== null && (dpw < 1 || dpw > 7 || !Number.isInteger(dpw))) err("Days per week must be a whole number from 1 to 7", "Days per week");
        const hpd = values.hoursPerDay as number | null;
        if (hpd !== null && (hpd <= 0 || hpd > 24)) err("Hours per day must be between 0 and 24", "Hours per day");
        if (values.dateOfBirth && values.hireDate && String(values.dateOfBirth) >= String(values.hireDate)) err("Date of birth must be before the hire date", "Date of birth");
        break;
      }
      case "departments": {
        const code = String(values.code ?? "").toUpperCase();
        if (departments.some((d) => d.code.toUpperCase() === code)) {
          status = "duplicate";
          err("Department code already exists", "Code");
        } else if (seen.has(code)) {
          status = "duplicate";
          err("Department code appears more than once in this file", "Code");
        }
        seen.add(code);
        break;
      }
      case "leave_balances": {
        const e = empFor();
        const lt = String(values.leaveType ?? "").toLowerCase();
        const type = leaveTypes.find((x) => x.code.toLowerCase() === lt || x.name.toLowerCase() === lt);
        if (lt && !type) err(`Leave type "${values.leaveType}" not found`, "Leave type");
        if (type && !type.tracksBalance) err(`${type.name} does not track a balance`, "Leave type");
        values.leaveTypeId = type?.id ?? null;
        values.employeeId = e?.id ?? null;
        const key = `${e?.id}|${type?.id}`;
        if (e && type && seen.has(key)) {
          status = "duplicate";
          err("Balance for this employee and leave type appears more than once", "Leave type");
        }
        seen.add(key);
        break;
      }
      case "attendance": {
        const e = empFor();
        values.employeeId = e?.id ?? null;
        const w = values.workedHours as number | null;
        const o = (values.overtimeHours as number | null) ?? 0;
        if (w !== null && (w < 0 || w > 24)) err("Worked hours must be between 0 and 24", "Worked hours");
        if (o < 0 || o > 24) err("Overtime hours must be between 0 and 24", "Overtime hours");
        if (values.absent && (w ?? 0) > 0) err("An absent day cannot have worked hours", "Absent");
        if (e && values.date) {
          if (String(values.date) < e.hireDate || (e.terminationDate && String(values.date) > e.terminationDate)) err("Date is outside the employment period", "Date");
          const key = `${e.id}|${values.date}`;
          if (tsKeys.has(key)) {
            status = "duplicate";
            err("A timesheet already exists for this day", "Date");
          } else if (seen.has(key)) {
            status = "duplicate";
            err("This employee and date appear more than once", "Date");
          }
          seen.add(key);
        }
        break;
      }
      case "pay_components":
      case "deductions": {
        const e = empFor();
        values.employeeId = e?.id ?? null;
        if ((values.amount as number) < 0) err("Amount cannot be negative", "Amount per period");
        if (values.endDate && values.startDate && String(values.endDate) < String(values.startDate)) err("End date is before start date", "End date");
        break;
      }
      case "loans": {
        const e = empFor();
        values.employeeId = e?.id ?? null;
        const p = values.principal as number;
        if (p <= 0) err("Principal must be greater than zero", "Principal");
        if ((values.installment as number) <= 0) err("Installment must be greater than zero", "Installment");
        if ((values.installment as number) > p) err("Installment exceeds principal", "Installment");
        if (((values.alreadyRepaid as number) ?? 0) > p) err("Already repaid exceeds principal", "Already repaid");
        if (values.startDate && values.issuedDate && String(values.startDate) < String(values.issuedDate)) err("First deduction is before the issue date", "First deduction date");
        break;
      }
      case "historical_payroll": {
        const e = empFor();
        values.employeeId = e?.id ?? null;
        if (values.periodEnd && values.periodStart && String(values.periodEnd) < String(values.periodStart)) err("Period end is before period start", "Period end");
        const deductions = ["ssEmployee", "nhiEmployee", "ptEmployee", "otherDeductions"].reduce((s, k) => s + ((values[k] as number) ?? 0), 0);
        const gross = values.gross as number;
        const net = values.net as number;
        if (gross !== null && net !== null && Math.abs(gross - deductions - net) > 0.02) err(`Gross minus deductions (${money(gross - deductions)}) does not equal net (${net})`, "Net pay");
        const key = `${e?.id}|${values.payDate}|${values.periodStart}`;
        if (e && seen.has(key)) {
          status = "duplicate";
          err("Duplicate employee and period", "Pay date");
        }
        seen.add(key);
        break;
      }
    }
    if (errors.length && status === "valid") status = "error";
    return { row: i + 2, status, errors, values, source };
  });
  if (input.rows.length === 0) notes.push("The file has no data rows.");
  return { rows: out, notes };
}

function summarize(rows: AnalyzedRow[]) {
  return {
    rows: rows.length,
    valid: rows.filter((r) => r.status === "valid").length,
    errors: rows.filter((r) => r.status === "error").length,
    duplicates: rows.filter((r) => r.status === "duplicate").length,
  };
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

async function commitRows(ctx: Ctx, entityName: ImportEntity, rows: AnalyzedRow[], batchId: string): Promise<number> {
  const c = ctx.actor.companyId;
  const now = nowISO(ctx);
  const ts = { createdAt: now, updatedAt: now };
  const v = (r: AnalyzedRow, k: string) => r.values[k];
  const s = (r: AnalyzedRow, k: string) => (r.values[k] === null || r.values[k] === undefined ? "" : String(r.values[k]));
  const company = await getCompany(ctx);

  switch (entityName) {
    case "departments": {
      const created = new Map<string, Department>();
      for (const r of rows) {
        const dep: Department = { id: ctx.ids("dept"), companyId: c, code: s(r, "code").toUpperCase(), name: s(r, "name"), parentId: null, ...ts };
        await ctx.repo.departments.insert(dep);
        created.set(dep.code, dep);
      }
      const all = await ctx.repo.departments.list(c);
      for (const r of rows) {
        const parent = s(r, "parentCode").toUpperCase();
        if (!parent) continue;
        const p = all.find((d) => d.code.toUpperCase() === parent);
        const me = created.get(s(r, "code").toUpperCase());
        if (p && me) await ctx.repo.departments.update(c, me.id, { parentId: p.id });
      }
      return rows.length;
    }
    case "employees": {
      const deps = await ctx.repo.departments.list(c);
      const policy = (await ctx.repo.leavePolicies.list(c, { where: { isDefault: true } }))[0] ?? null;
      const codeToId = new Map((await ctx.repo.employees.list(c)).map((e) => [e.employeeCode.toUpperCase(), e.id]));
      const pendingManagers: { id: string; managerCode: string }[] = [];
      for (const r of rows) {
        let departmentId: string | null = null;
        const depName = s(r, "department");
        if (depName) {
          let dep = deps.find((d) => d.name.toLowerCase() === depName.toLowerCase() || d.code.toLowerCase() === depName.toLowerCase());
          if (!dep) {
            const base = depName.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase() || "DEPT";
            let code = base;
            let i = 2;
            while (deps.some((d) => d.code === code)) code = `${base}${i++}`;
            dep = { id: ctx.ids("dept"), companyId: c, name: depName, code, parentId: null, ...ts };
            await ctx.repo.departments.insert(dep);
            deps.push(dep);
          }
          departmentId = dep.id;
        }
        const id = ctx.ids("emp");
        const code = s(r, "employeeCode").toUpperCase();
        const hireDate = s(r, "hireDate");
        const employee: Employee = {
          id,
          companyId: c,
          employeeCode: code,
          firstName: s(r, "firstName"),
          lastName: s(r, "lastName"),
          preferredName: s(r, "preferredName"),
          dateOfBirth: s(r, "dateOfBirth"),
          email: s(r, "email"),
          phone: s(r, "phone"),
          address: { line1: s(r, "addressLine1"), city: s(r, "city"), country: s(r, "country") || company.address.country },
          emergencyContact: { name: s(r, "emergencyName"), relationship: "", phone: s(r, "emergencyPhone") },
          statutoryIds: { socialSecurityNumber: s(r, "socialSecurityNumber"), nhiNumber: s(r, "nhiNumber"), taxId: s(r, "taxId") },
          status: "active",
          employmentType: (v(r, "employmentType") as Employee["employmentType"]) ?? "full_time",
          hireDate,
          probationEndDate: null,
          terminationDate: null,
          terminationReason: null,
          departmentId,
          position: s(r, "position"),
          managerId: null,
          workLocation: s(r, "workLocation"),
          leavePolicyId: policy?.id ?? null,
          payProfile: { payMethod: (v(r, "payMethod") as Employee["payProfile"]["payMethod"]) ?? "bank_transfer", bankName: s(r, "bankName"), bankAccount: s(r, "bankAccount") },
          notes: [],
          userId: null,
          ...ts,
        };
        await ctx.repo.employees.insert(employee);
        codeToId.set(code, id);
        if (s(r, "managerCode")) pendingManagers.push({ id, managerCode: s(r, "managerCode").toUpperCase() });
        await ctx.repo.employmentEvents.insert({ id: ctx.ids("evt"), companyId: c, employeeId: id, effectiveDate: hireDate, type: "hire", departmentId, position: employee.position, employmentType: employee.employmentType, note: `Imported (batch ${batchId})`, createdBy: ctx.actor.userId, ...ts });
        const dpw = (v(r, "daysPerWeek") as number | null) ?? 5;
        await ctx.repo.schedules.insert({ id: ctx.ids("sch"), companyId: c, employeeId: id, effectiveFrom: hireDate, workDays: WEEKDAYS.slice(0, dpw).sort(), hoursPerDay: (v(r, "hoursPerDay") as number | null) ?? 8, reason: "Imported", createdBy: ctx.actor.userId, ...ts });
        if (v(r, "rateAmount") !== null && v(r, "rateAmount") !== undefined) {
          await ctx.repo.payRates.insert({
            id: ctx.ids("rate"),
            companyId: c,
            employeeId: id,
            effectiveFrom: hireDate,
            payType: (v(r, "payType") as "salary" | "hourly") ?? (v(r, "rateBasis") === "hourly" ? "hourly" : "salary"),
            amount: v(r, "rateAmount") as number,
            basis: v(r, "rateBasis") as PayRate["basis"],
            payFrequency: v(r, "payFrequency") as PayRate["payFrequency"],
            reason: "Imported",
            createdBy: ctx.actor.userId,
            ...ts,
          });
        }
      }
      for (const pm of pendingManagers) {
        const managerId = codeToId.get(pm.managerCode);
        if (managerId) await ctx.repo.employees.update(c, pm.id, { managerId });
      }
      return rows.length;
    }
    case "leave_balances": {
      const today = await companyToday(ctx);
      const entries: LeaveLedgerEntry[] = rows.map((r) => ({ id: ctx.ids("lvl"), companyId: c, employeeId: s(r, "employeeId"), leaveTypeId: s(r, "leaveTypeId"), date: s(r, "asOfDate") || today, amount: v(r, "balance") as number, kind: "adjustment", reason: `Opening balance imported (batch ${batchId})`, requestId: null, createdBy: ctx.actor.userId, ...ts }));
      await ctx.repo.leaveLedger.insertMany(entries);
      return entries.length;
    }
    case "attendance": {
      const schedules = await ctx.repo.schedules.list(c);
      const entries: TimesheetEntry[] = rows.map((r) => {
        const sch = effectiveOn(schedules.filter((x) => x.employeeId === s(r, "employeeId")), s(r, "date"));
        return { id: ctx.ids("ts"), companyId: c, employeeId: s(r, "employeeId"), date: s(r, "date"), scheduledHours: sch && isScheduledDay(s(r, "date"), sch.workDays) ? sch.hoursPerDay : 0, workedHours: (v(r, "workedHours") as number) ?? 0, overtimeHours: (v(r, "overtimeHours") as number) ?? 0, lateMinutes: (v(r, "lateMinutes") as number) ?? 0, absent: !!v(r, "absent"), status: "submitted", source: "import", note: s(r, "note"), approvedBy: null, approvedAt: null, ...ts };
      });
      await ctx.repo.timesheets.insertMany(entries);
      return entries.length;
    }
    case "pay_components":
    case "deductions": {
      const items: PayItem[] = rows.map((r) => ({ id: ctx.ids("item"), companyId: c, employeeId: s(r, "employeeId"), kind: entityName === "deductions" ? "deduction" : "earning", category: v(r, "category") as PayItem["category"], label: s(r, "label"), method: "fixed", amount: v(r, "amount") as number, taxable: entityName === "pay_components" ? (v(r, "taxable") as boolean) : false, pretax: entityName === "deductions" ? (v(r, "pretax") as boolean) : false, startDate: s(r, "startDate"), endDate: s(r, "endDate") || null, active: true, ...ts }));
      await ctx.repo.payItems.insertMany(items);
      return items.length;
    }
    case "loans": {
      let count = await ctx.repo.loans.count(c);
      const loans: Loan[] = rows.map((r) => {
        count += 1;
        const repaid = (v(r, "alreadyRepaid") as number | null) ?? 0;
        return { id: ctx.ids("loan"), companyId: c, employeeId: s(r, "employeeId"), type: v(r, "type") as Loan["type"], reference: s(r, "reference") || `${v(r, "type") === "loan" ? "LN" : "ADV"}-${String(count).padStart(4, "0")}`, principal: v(r, "principal") as number, installment: v(r, "installment") as number, issuedDate: s(r, "issuedDate"), startDate: s(r, "startDate"), status: repaid >= (v(r, "principal") as number) ? "paid" : "active", note: `Imported (batch ${batchId})`, manualRepayments: repaid > 0 ? [{ date: s(r, "issuedDate"), amount: repaid, note: "Repaid before import", payrollResultId: null }] : [], ...ts };
      });
      await ctx.repo.loans.insertMany(loans);
      return loans.length;
    }
    case "historical_payroll": {
      const employees = new Map((await ctx.repo.employees.list(c)).map((e) => [e.id, e]));
      const deps = new Map((await ctx.repo.departments.list(c)).map((d) => [d.id, d.name]));
      const groups = new Map<string, AnalyzedRow[]>();
      for (const r of rows) {
        const key = `${s(r, "periodStart")}|${s(r, "periodEnd")}|${s(r, "payDate")}`;
        groups.set(key, [...(groups.get(key) ?? []), r]);
      }
      for (const [key, rs] of groups) {
        const [periodStart, periodEnd, payDate] = key.split("|");
        const runId = ctx.ids("run");
        const results: PayrollEmployeeResult[] = rs.map((r) => {
          const e = employees.get(s(r, "employeeId"))!;
          const num = (k: string) => (v(r, k) as number | null) ?? 0;
          const statutory = [
            { code: "SS", name: "Social Security", type: "social_security" as const, ee: num("ssEmployee"), er: num("ssEmployer") },
            { code: "NHI", name: "National Health Insurance", type: "nhi" as const, ee: num("nhiEmployee"), er: num("nhiEmployer") },
            { code: "PT", name: "Payroll Tax", type: "payroll_tax" as const, ee: num("ptEmployee"), er: num("ptEmployer") },
          ].filter((x) => x.ee || x.er);
          const lines: PayrollLine[] = [
            { code: "earning.historical", section: "earning", category: "regular", label: "Gross pay (imported)", amount: num("gross"), taxable: true, formula: "Imported historical total", source: "historical" },
            ...statutory.flatMap((x) => [
              ...(x.ee ? [{ code: `statutory_employee.${x.code}`, section: "statutory_employee" as const, category: x.type, label: `${x.name} (employee)`, amount: x.ee, taxable: false, formula: "Imported historical total", source: "historical" as const }] : []),
              ...(x.er ? [{ code: `statutory_employer.${x.code}`, section: "statutory_employer" as const, category: x.type, label: `${x.name} (employer)`, amount: x.er, taxable: false, formula: "Imported historical total", source: "historical" as const }] : []),
            ]),
            ...(num("otherDeductions") ? [{ code: "deduction.historical", section: "deduction" as const, category: "other", label: "Other deductions (imported)", amount: num("otherDeductions"), taxable: false, formula: "Imported historical total", source: "historical" as const }] : []),
          ];
          const ee = money(sum(statutory.map((x) => x.ee)));
          const er = money(sum(statutory.map((x) => x.er)));
          return {
            id: ctx.ids("res"),
            companyId: c,
            runId,
            employeeId: e.id,
            payDate,
            periodStart,
            periodEnd,
            runType: "historical",
            employee: { code: e.employeeCode, name: displayName(e), departmentName: e.departmentId ? (deps.get(e.departmentId) ?? "") : "", position: e.position, payType: "salary", employmentType: e.employmentType, payMethod: e.payProfile.payMethod, bankAccountMasked: "" },
            rates: { segments: [], schedule: { workDays: [], hoursPerDay: 0 }, methodology: "Imported historical totals" },
            lines,
            totals: { gross: num("gross"), preTaxDeductions: 0, taxable: num("gross"), employeeStatutory: ee, employerStatutory: er, postTaxDeductions: num("otherDeductions"), net: num("net"), employerCost: money(num("gross") + er) },
            statutory: statutory.map((x) => ({ ruleId: "historical", code: x.code, name: x.name, type: x.type, status: "approved" as const, effectiveFrom: periodStart, employeeRate: 0, employerRate: 0, base: num("gross"), exemptAmount: 0, ceilingApplied: false, contributableBase: num("gross"), employeeAmount: x.ee, employerAmount: x.er, explanation: "Imported historical total" })),
            workedDays: 0,
            scheduledDays: 0,
            warnings: [],
            calculationVersion: `historical-import`,
            ...ts,
          };
        });
        const run: PayrollRun = {
          id: runId,
          companyId: c,
          type: "historical",
          payFrequency: "monthly",
          periodStart,
          periodEnd,
          payDate,
          status: "locked",
          name: `Historical payroll · ${formatRange(periodStart, periodEnd)}`,
          correctsRunId: null,
          correctionReason: null,
          employeeIds: results.map((r) => r.employeeId),
          inputs: [],
          totals: sumTotals(results),
          preflight: { issues: [], ranAt: null, acknowledged: [] },
          calculationVersion: CALCULATION_VERSION,
          stale: false,
          history: [{ status: "created", at: now, by: ctx.actor.userId, byName: ctx.actor.name, note: `Imported (batch ${batchId})` }, { status: "locked", at: now, by: ctx.actor.userId, byName: ctx.actor.name }],
          createdBy: ctx.actor.userId,
          ...ts,
        };
        await ctx.repo.payrollRuns.insert(run);
        await ctx.repo.payrollResults.insertMany(results);
      }
      return rows.length;
    }
  }
}

export const importProcedures = {
  "imports.validate": query({
    input: inputSchema,
    permission: "imports.run",
    feature: "imports",
    handler: async (ctx, input) => {
      assertPermission(ctx.actor, ENTITY_PERMISSION[input.entity]);
      const { rows, notes } = await analyze(ctx, input);
      return { summary: summarize(rows), rows: rows.map(({ source, ...r }) => ({ ...r, source })), notes };
    },
  }),

  "imports.commit": mutation({
    input: inputSchema,
    permission: "imports.run",
    feature: "imports",
    handler: async (ctx, input) => {
      assertPermission(ctx.actor, ENTITY_PERMISSION[input.entity]);
      if (input.rows.length === 0) throw validation("The file has no data rows.");
      const { rows } = await analyze(ctx, input);
      const valid = rows.filter((r) => r.status === "valid");
      if (valid.length === 0) throw conflict("No rows are valid. Fix the errors and try again.");
      const batchId = ctx.ids("imp");
      const imported = await ctx.repo.transaction(async (repo) => commitRows({ ...ctx, repo }, input.entity, valid, batchId));
      const summary = summarize(rows);
      const now = nowISO(ctx);
      const batch: ImportBatch = {
        id: batchId,
        companyId: ctx.actor.companyId,
        entity: input.entity,
        fileName: input.fileName,
        status: summary.errors + summary.duplicates > 0 ? "completed_with_errors" : "completed",
        totals: { rows: summary.rows, imported, rejected: summary.errors, duplicates: summary.duplicates },
        errors: rows.flatMap((r) => r.errors).slice(0, 2000),
        mapping: input.mapping,
        createdBy: ctx.actor.userId,
        createdByName: ctx.actor.name,
        createdAt: now,
        updatedAt: now,
      };
      await ctx.repo.importBatches.insert(batch);
      await audit(ctx, { action: "import.completed", entityType: "import_batch", entityId: batchId, summary: `Imported ${imported} ${IMPORT_DEFINITIONS[input.entity].title.toLowerCase()} from ${input.fileName} (${summary.errors} rejected, ${summary.duplicates} duplicates)` });
      return { batch, rejected: rows.filter((r) => r.status !== "valid").map((r) => ({ row: r.row, status: r.status, errors: r.errors, source: r.source })) };
    },
  }),

  "imports.list": query({
    input: z.object({}),
    permission: "imports.run",
    handler: async (ctx) => (await ctx.repo.importBatches.list(ctx.actor.companyId, { limit: 50 })).map((b) => ({ ...b, errors: b.errors.slice(0, 50), createdAtLabel: formatDate(b.createdAt.slice(0, 10)) })),
  }),
};
