/**
 * Spreadsheet import definitions: target fields, synonyms used for automatic
 * column matching, and value parsers. Shared by the wizard UI and the server.
 */
import type { ImportEntity } from "@/domain/types";

export type FieldKind = "text" | "date" | "number" | "boolean" | "enum";

export interface ImportField {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  synonyms: string[];
  options?: Record<string, string[]>;
  help?: string;
  example: string;
}

export interface ImportDefinition {
  entity: ImportEntity;
  title: string;
  description: string;
  fields: ImportField[];
}

const yesNo = (key: string, label: string, synonyms: string[], example = "yes"): ImportField => ({ key, label, kind: "boolean", synonyms, example });

export const IMPORT_DEFINITIONS: Record<ImportEntity, ImportDefinition> = {
  employees: {
    entity: "employees",
    title: "Employees",
    description: "Create employee records with employment, schedule and (optionally) pay details.",
    fields: [
      { key: "employeeCode", label: "Employee ID", kind: "text", required: true, synonyms: ["employee id", "emp id", "id", "employee number", "emp no", "staff id", "code"], example: "E-1042" },
      { key: "firstName", label: "First name", kind: "text", required: true, synonyms: ["first name", "given name", "forename", "first"], example: "Maya" },
      { key: "lastName", label: "Last name", kind: "text", required: true, synonyms: ["last name", "surname", "family name", "last"], example: "Penn" },
      { key: "fullName", label: "Full name (split automatically)", kind: "text", synonyms: ["full name", "name", "employee name"], help: "Used when first/last name columns are not present.", example: "" },
      { key: "preferredName", label: "Preferred name", kind: "text", synonyms: ["preferred name", "known as", "nickname"], example: "" },
      { key: "dateOfBirth", label: "Date of birth", kind: "date", required: true, synonyms: ["date of birth", "dob", "birth date", "birthday"], example: "1991-04-18" },
      { key: "email", label: "Email", kind: "text", synonyms: ["email", "e-mail", "work email", "email address"], example: "maya.penn@example.com" },
      { key: "phone", label: "Phone", kind: "text", synonyms: ["phone", "mobile", "telephone", "cell"], example: "+1 284 555 0142" },
      { key: "addressLine1", label: "Address", kind: "text", synonyms: ["address", "address line 1", "street"], example: "12 Main Street" },
      { key: "city", label: "City", kind: "text", synonyms: ["city", "town"], example: "Road Town" },
      { key: "country", label: "Country", kind: "text", synonyms: ["country"], example: "British Virgin Islands" },
      { key: "department", label: "Department", kind: "text", synonyms: ["department", "dept", "team", "division"], help: "Department name or code. New names are created automatically.", example: "Finance" },
      { key: "position", label: "Position", kind: "text", required: true, synonyms: ["position", "job title", "title", "role"], example: "Accounts Assistant" },
      { key: "managerCode", label: "Manager Employee ID", kind: "text", synonyms: ["manager id", "manager", "reports to", "supervisor id", "manager employee id"], example: "E-1001" },
      { key: "employmentType", label: "Employment type", kind: "enum", synonyms: ["employment type", "type", "contract type"], options: { full_time: ["full time", "full-time", "ft", "permanent"], part_time: ["part time", "part-time", "pt"], contract: ["contract", "contractor"], temporary: ["temporary", "temp", "seasonal"] }, example: "full-time" },
      { key: "hireDate", label: "Hire date", kind: "date", required: true, synonyms: ["hire date", "start date", "date hired", "joining date", "joined"], example: "2023-02-01" },
      { key: "workLocation", label: "Work location", kind: "text", synonyms: ["location", "work location", "office", "site"], example: "Road Town" },
      { key: "payType", label: "Pay type", kind: "enum", synonyms: ["pay type", "salary type"], options: { salary: ["salary", "salaried", "s"], hourly: ["hourly", "wage", "h"] }, example: "salary" },
      { key: "rateAmount", label: "Salary / rate", kind: "number", synonyms: ["salary", "annual salary", "monthly salary", "rate", "pay rate", "hourly rate", "wage"], example: "36000" },
      { key: "rateBasis", label: "Rate basis", kind: "enum", synonyms: ["rate basis", "basis", "per"], options: { annual: ["annual", "yearly", "per year", "year"], monthly: ["monthly", "per month", "month"], semi_monthly: ["semi-monthly", "semimonthly"], biweekly: ["biweekly", "fortnightly"], weekly: ["weekly", "per week"], daily: ["daily", "per day"], hourly: ["hourly", "per hour", "hour"] }, example: "annual" },
      { key: "payFrequency", label: "Pay frequency", kind: "enum", synonyms: ["pay frequency", "frequency", "paid"], options: { monthly: ["monthly"], semi_monthly: ["semi-monthly", "semimonthly", "twice monthly"], biweekly: ["biweekly", "fortnightly", "every two weeks"], weekly: ["weekly"] }, example: "monthly" },
      { key: "daysPerWeek", label: "Days per week", kind: "number", synonyms: ["days per week", "work days", "days/week"], help: "5 = Mon–Fri, 6 = Mon–Sat, fewer = starting Monday.", example: "5" },
      { key: "hoursPerDay", label: "Hours per day", kind: "number", synonyms: ["hours per day", "daily hours", "hours/day"], example: "8" },
      { key: "socialSecurityNumber", label: "Social Security number", kind: "text", synonyms: ["social security", "ss number", "ss no", "ssn", "social security number"], example: "SS-204511" },
      { key: "nhiNumber", label: "NHI number", kind: "text", synonyms: ["nhi", "nhi number", "health insurance number"], example: "NHI-88231" },
      { key: "taxId", label: "Tax ID", kind: "text", synonyms: ["tax id", "tin", "tax number", "payroll tax id"], example: "" },
      { key: "payMethod", label: "Pay method", kind: "enum", synonyms: ["pay method", "payment method"], options: { bank_transfer: ["bank", "bank transfer", "direct deposit", "transfer"], cheque: ["cheque", "check"], cash: ["cash"] }, example: "bank transfer" },
      { key: "bankName", label: "Bank name", kind: "text", synonyms: ["bank", "bank name"], example: "First Caribbean" },
      { key: "bankAccount", label: "Bank account", kind: "text", synonyms: ["account number", "bank account", "account no"], example: "0012345678" },
      { key: "emergencyName", label: "Emergency contact", kind: "text", synonyms: ["emergency contact", "emergency name", "next of kin"], example: "Jordan Penn" },
      { key: "emergencyPhone", label: "Emergency phone", kind: "text", synonyms: ["emergency phone", "emergency number"], example: "+1 284 555 0199" },
    ],
  },
  departments: {
    entity: "departments",
    title: "Departments",
    description: "Create departments and their parent structure.",
    fields: [
      { key: "code", label: "Code", kind: "text", required: true, synonyms: ["code", "department code", "dept code"], example: "FIN" },
      { key: "name", label: "Name", kind: "text", required: true, synonyms: ["name", "department", "department name"], example: "Finance" },
      { key: "parentCode", label: "Parent code", kind: "text", synonyms: ["parent", "parent code", "parent department"], example: "" },
    ],
  },
  leave_balances: {
    entity: "leave_balances",
    title: "Leave balances",
    description: "Opening leave balances carried over from your previous system or spreadsheet.",
    fields: [
      { key: "employeeCode", label: "Employee ID", kind: "text", required: true, synonyms: ["employee id", "emp id", "id", "employee"], example: "E-1042" },
      { key: "leaveType", label: "Leave type", kind: "text", required: true, synonyms: ["leave type", "type", "leave"], help: "Leave type code or name (e.g. VAC or Vacation).", example: "VAC" },
      { key: "balance", label: "Balance", kind: "number", required: true, synonyms: ["balance", "days", "hours", "remaining", "available"], example: "7.5" },
      { key: "asOfDate", label: "As of date", kind: "date", synonyms: ["as of", "date", "as of date"], example: "2026-01-01" },
    ],
  },
  attendance: {
    entity: "attendance",
    title: "Attendance",
    description: "Timesheet days. Imported days are submitted for approval before they feed payroll.",
    fields: [
      { key: "employeeCode", label: "Employee ID", kind: "text", required: true, synonyms: ["employee id", "emp id", "id"], example: "E-1042" },
      { key: "date", label: "Date", kind: "date", required: true, synonyms: ["date", "work date", "day"], example: "2026-10-01" },
      { key: "workedHours", label: "Worked hours", kind: "number", required: true, synonyms: ["hours", "worked hours", "regular hours", "hours worked"], example: "8" },
      { key: "overtimeHours", label: "Overtime hours", kind: "number", synonyms: ["overtime", "ot", "overtime hours", "ot hours"], example: "1.5" },
      { key: "lateMinutes", label: "Late minutes", kind: "number", synonyms: ["late", "late minutes", "minutes late"], example: "0" },
      yesNo("absent", "Absent", ["absent", "absence"], "no"),
      { key: "note", label: "Note", kind: "text", synonyms: ["note", "notes", "comment"], example: "" },
    ],
  },
  pay_components: {
    entity: "pay_components",
    title: "Recurring earnings",
    description: "Allowances, regular commissions and other recurring earnings.",
    fields: [
      { key: "employeeCode", label: "Employee ID", kind: "text", required: true, synonyms: ["employee id", "emp id", "id"], example: "E-1042" },
      { key: "category", label: "Category", kind: "enum", required: true, synonyms: ["category", "type"], options: { allowance: ["allowance", "housing", "transport"], commission: ["commission"], bonus: ["bonus"], other: ["other"] }, example: "allowance" },
      { key: "label", label: "Description", kind: "text", required: true, synonyms: ["description", "label", "name", "item"], example: "Transport allowance" },
      { key: "amount", label: "Amount per period", kind: "number", required: true, synonyms: ["amount", "value"], example: "150" },
      yesNo("taxable", "Taxable", ["taxable", "statutory"], "yes"),
      { key: "startDate", label: "Start date", kind: "date", required: true, synonyms: ["start", "start date", "from"], example: "2026-01-01" },
      { key: "endDate", label: "End date", kind: "date", synonyms: ["end", "end date", "to", "until"], example: "" },
    ],
  },
  deductions: {
    entity: "deductions",
    title: "Recurring deductions",
    description: "Pension, health and other recurring employee deductions.",
    fields: [
      { key: "employeeCode", label: "Employee ID", kind: "text", required: true, synonyms: ["employee id", "emp id", "id"], example: "E-1042" },
      { key: "category", label: "Category", kind: "enum", required: true, synonyms: ["category", "type"], options: { pension: ["pension", "retirement"], health: ["health", "medical", "insurance"], union: ["union", "dues"], garnishment: ["garnishment", "court order"], other: ["other"] }, example: "health" },
      { key: "label", label: "Description", kind: "text", required: true, synonyms: ["description", "label", "name"], example: "Group health plan" },
      { key: "amount", label: "Amount per period", kind: "number", required: true, synonyms: ["amount", "value"], example: "45" },
      yesNo("pretax", "Pre-tax", ["pre-tax", "pretax", "before tax"], "no"),
      { key: "startDate", label: "Start date", kind: "date", required: true, synonyms: ["start", "start date", "from"], example: "2026-01-01" },
      { key: "endDate", label: "End date", kind: "date", synonyms: ["end", "end date", "to"], example: "" },
    ],
  },
  loans: {
    entity: "loans",
    title: "Loans & advances",
    description: "Outstanding employee loans and salary advances repaid through payroll.",
    fields: [
      { key: "employeeCode", label: "Employee ID", kind: "text", required: true, synonyms: ["employee id", "emp id", "id"], example: "E-1042" },
      { key: "type", label: "Type", kind: "enum", required: true, synonyms: ["type"], options: { loan: ["loan"], advance: ["advance", "salary advance"] }, example: "loan" },
      { key: "reference", label: "Reference", kind: "text", synonyms: ["reference", "ref", "loan number"], example: "LN-2041" },
      { key: "principal", label: "Principal", kind: "number", required: true, synonyms: ["principal", "amount", "loan amount"], example: "1200" },
      { key: "installment", label: "Installment", kind: "number", required: true, synonyms: ["installment", "instalment", "repayment", "deduction"], example: "100" },
      { key: "alreadyRepaid", label: "Already repaid", kind: "number", synonyms: ["repaid", "already repaid", "paid to date"], example: "300" },
      { key: "issuedDate", label: "Issued date", kind: "date", required: true, synonyms: ["issued", "issue date", "date issued"], example: "2026-03-01" },
      { key: "startDate", label: "First deduction date", kind: "date", required: true, synonyms: ["start", "start date", "first deduction"], example: "2026-04-01" },
    ],
  },
  historical_payroll: {
    entity: "historical_payroll",
    title: "Historical payroll",
    description: "Prior payroll totals per employee so year-to-date figures and reports are complete.",
    fields: [
      { key: "employeeCode", label: "Employee ID", kind: "text", required: true, synonyms: ["employee id", "emp id", "id"], example: "E-1042" },
      { key: "periodStart", label: "Period start", kind: "date", required: true, synonyms: ["period start", "from"], example: "2026-01-01" },
      { key: "periodEnd", label: "Period end", kind: "date", required: true, synonyms: ["period end", "to"], example: "2026-01-31" },
      { key: "payDate", label: "Pay date", kind: "date", required: true, synonyms: ["pay date", "paid on", "date paid"], example: "2026-01-30" },
      { key: "gross", label: "Gross pay", kind: "number", required: true, synonyms: ["gross", "gross pay", "total earnings"], example: "3000" },
      { key: "ssEmployee", label: "Social Security (employee)", kind: "number", synonyms: ["ss employee", "social security employee", "ss ee"], example: "135" },
      { key: "ssEmployer", label: "Social Security (employer)", kind: "number", synonyms: ["ss employer", "social security employer", "ss er"], example: "135" },
      { key: "nhiEmployee", label: "NHI (employee)", kind: "number", synonyms: ["nhi employee", "nhi ee"], example: "112.5" },
      { key: "nhiEmployer", label: "NHI (employer)", kind: "number", synonyms: ["nhi employer", "nhi er"], example: "112.5" },
      { key: "ptEmployee", label: "Payroll Tax (employee)", kind: "number", synonyms: ["payroll tax employee", "pt employee", "pt ee"], example: "173.33" },
      { key: "ptEmployer", label: "Payroll Tax (employer)", kind: "number", synonyms: ["payroll tax employer", "pt employer", "pt er"], example: "60" },
      { key: "otherDeductions", label: "Other deductions", kind: "number", synonyms: ["deductions", "other deductions"], example: "0" },
      { key: "net", label: "Net pay", kind: "number", required: true, synonyms: ["net", "net pay", "take home"], example: "2579.17" },
    ],
  },
};

export type DateOrder = "YMD" | "DMY" | "MDY";

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function validYMD(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > last) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseDateValue(raw: string, order: DateOrder): string | null {
  const v = raw.trim();
  let mt = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(v);
  if (mt) return validYMD(+mt[1], +mt[2], +mt[3]);
  mt = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(v);
  if (mt) {
    let y = +mt[3];
    if (y < 100) y += y > 50 ? 1900 : 2000;
    return order === "MDY" ? validYMD(y, +mt[1], +mt[2]) : validYMD(y, +mt[2], +mt[1]);
  }
  mt = /^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-,]+(\d{4})$/.exec(v);
  if (mt && MONTHS[mt[2].toLowerCase()]) return validYMD(+mt[3], MONTHS[mt[2].toLowerCase()], +mt[1]);
  mt = /^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(v);
  if (mt && MONTHS[mt[1].toLowerCase()]) return validYMD(+mt[3], MONTHS[mt[1].toLowerCase()], +mt[2]);
  return null;
}

export function parseNumberValue(raw: string): number | null {
  let v = raw.trim().replace(/[$€£,\s]/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(v)) {
    negative = true;
    v = v.slice(1, -1);
  }
  if (!/^-?\d*\.?\d+$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

export function parseBooleanValue(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (["yes", "y", "true", "1", "x"].includes(v)) return true;
  if (["no", "n", "false", "0", ""].includes(v)) return false;
  return null;
}

export function parseEnumValue(raw: string, options: Record<string, string[]>): string | null {
  const v = raw.trim().toLowerCase().replace(/_/g, " ");
  for (const [key, syns] of Object.entries(options)) {
    if (v === key.replace(/_/g, " ") || syns.includes(v)) return key;
  }
  return null;
}

const normalizeHeader = (h: string) => h.toLowerCase().replace(/[_\-./]+/g, " ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/** Suggest a mapping of source column → target field key. */
export function autoMap(headers: string[], def: ImportDefinition): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  const score = (header: string, f: ImportField) => {
    const h = normalizeHeader(header);
    if (h === normalizeHeader(f.label) || h === normalizeHeader(f.key)) return 3;
    if (f.synonyms.some((s) => normalizeHeader(s) === h)) return 2;
    if (f.synonyms.some((s) => h.includes(normalizeHeader(s)) && normalizeHeader(s).length >= 4)) return 1;
    return 0;
  };
  for (const pass of [3, 2, 1]) {
    for (const header of headers) {
      if (mapping[header]) continue;
      const best = def.fields.find((f) => !used.has(f.key) && score(header, f) === pass);
      if (best) {
        mapping[header] = best.key;
        used.add(best.key);
      }
    }
  }
  return mapping;
}

export interface ParsedCell {
  value: string | number | boolean | null;
  error?: string;
}

export function parseField(field: ImportField, raw: string | undefined, order: DateOrder): ParsedCell {
  const v = (raw ?? "").toString().trim();
  if (!v) return field.required ? { value: null, error: `${field.label} is required` } : { value: field.kind === "boolean" ? false : null };
  switch (field.kind) {
    case "text":
      return v.length > 200 ? { value: null, error: `${field.label} is too long` } : { value: v };
    case "date": {
      const d = parseDateValue(v, order);
      return d ? { value: d } : { value: null, error: `${field.label} "${v}" is not a valid date` };
    }
    case "number": {
      const n = parseNumberValue(v);
      return n === null ? { value: null, error: `${field.label} "${v}" is not a number` } : { value: n };
    }
    case "boolean": {
      const b = parseBooleanValue(v);
      return b === null ? { value: null, error: `${field.label} "${v}" should be yes or no` } : { value: b };
    }
    case "enum": {
      const e = parseEnumValue(v, field.options ?? {});
      return e ? { value: e } : { value: null, error: `${field.label} "${v}" is not recognised (use ${Object.keys(field.options ?? {}).map((k) => k.replace(/_/g, "-")).join(", ")})` };
    }
  }
}

export function templateRows(def: ImportDefinition): { headers: string[]; example: string[] } {
  return { headers: def.fields.filter((f) => f.key !== "fullName").map((f) => f.label), example: def.fields.filter((f) => f.key !== "fullName").map((f) => f.example) };
}
