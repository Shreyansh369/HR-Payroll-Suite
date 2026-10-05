/**
 * Fictional demo dataset. Every name, identifier and figure is synthetic.
 * The seed is generated relative to "today" so the demo always looks current,
 * and payroll history is produced by the real calculation engine and procedures.
 */
import type {
  AttendanceCorrection,
  Company,
  Department,
  Employee,
  EmployeeDocument,
  EmploymentEvent,
  LeaveLedgerEntry,
  LeaveRequest,
  Loan,
  Organization,
  PayFrequency,
  PayItem,
  PayRate,
  RateBasis,
  TimesheetEntry,
  User,
  WorkSchedule,
  Workflow,
} from "@/domain/types";
import { InMemoryRepository, MemoryDocumentStorage, type RepositoryState } from "@/repositories/memory/memory-repository";
import { provisionCompany, provisionRoles } from "@/services/provisioning";
import { execute, type Ctx } from "@/services/core";
import { resolveActor } from "@/services/authz";
import { demoEntitlements } from "@/services/entitlements";
import { procedures } from "@/services/registry";
import { sequentialIds, type IdGenerator } from "@/lib/ids";
import { addDays, addMonths, dayOfWeek, eachDay, endOfMonth, startOfMonth, yearOf, monthOf, type ISODate, formatDate } from "@/lib/dates";
import { periodContaining, previousPeriod, type PayPeriod } from "@/domain/payroll/calendar";
import { effectiveOn, isScheduledDay } from "@/domain/employee/schedule";
import { leaveQuantity } from "@/domain/leave/balances";
import { ONBOARDING_TEMPLATE, OFFBOARDING_TEMPLATE } from "@/config/defaults";
import { minimalPdf } from "@/lib/minimal-pdf";
import { sha256Hex } from "@/lib/bytes";

export { DEMO_PASSWORD, DEMO_ACCOUNTS } from "@/repositories/demo/seed-accounts";

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface EmpSpec {
  code: string;
  first: string;
  last: string;
  preferred?: string;
  dept: string;
  position: string;
  manager?: string;
  type?: Employee["employmentType"];
  payType: "salary" | "hourly";
  amount: number;
  basis: RateBasis;
  freq: PayFrequency;
  hire: ISODate;
  dob: ISODate;
  days?: number[];
  hours?: number;
  location?: string;
  status?: Employee["status"];
  raise?: { from: ISODate; amount: number; reason: string; position?: string };
}

const MON_FRI = [1, 2, 3, 4, 5];

const HHL: EmpSpec[] = [
  { code: "HHL-001", first: "Marcus", last: "Wheatley", dept: "EXE", position: "General Manager", payType: "salary", amount: 96000, basis: "annual", freq: "monthly", hire: "2016-03-14", dob: "1974-10-12" },
  { code: "HHL-002", first: "Renée", last: "Faulkner", dept: "HR", position: "HR Manager", manager: "HHL-001", payType: "salary", amount: 62000, basis: "annual", freq: "monthly", hire: "2018-10-09", dob: "1983-02-21" },
  { code: "HHL-003", first: "Desmond", last: "Hodge", dept: "FIN", position: "Finance Controller", manager: "HHL-001", payType: "salary", amount: 72000, basis: "annual", freq: "monthly", hire: "2017-06-01", dob: "1979-07-30" },
  { code: "HHL-004", first: "Alana", last: "Christopher", dept: "FIN", position: "Payroll & Accounts Officer", manager: "HHL-003", payType: "salary", amount: 3400, basis: "monthly", freq: "monthly", hire: "2020-01-13", dob: "1990-10-19" },
  { code: "HHL-005", first: "Kervin", last: "Stoutt", dept: "FB", position: "Food & Beverage Manager", manager: "HHL-001", payType: "salary", amount: 4200, basis: "monthly", freq: "monthly", hire: "2019-04-15", dob: "1985-05-03" },
  { code: "HHL-006", first: "Shanice", last: "Penn", dept: "FB", position: "Restaurant Supervisor", manager: "HHL-005", payType: "salary", amount: 2000, basis: "monthly", freq: "monthly", hire: "2021-08-02", dob: "1994-01-27" },
  { code: "HHL-007", first: "Jamal", last: "Romney", dept: "FB", position: "Line Cook", manager: "HHL-005", payType: "hourly", amount: 14.5, basis: "hourly", freq: "biweekly", hire: "2022-02-07", dob: "1996-09-02" },
  { code: "HHL-008", first: "Patrice", last: "Vanterpool", dept: "FB", position: "Bartender", manager: "HHL-005", type: "part_time", payType: "hourly", amount: 13, basis: "hourly", freq: "biweekly", hire: "2023-05-22", dob: "1998-11-15", days: [3, 4, 5, 6], hours: 7 },
  { code: "HHL-009", first: "Darnell", last: "Frett", dept: "FB", position: "Server", manager: "HHL-005", type: "part_time", payType: "hourly", amount: 11.5, basis: "hourly", freq: "biweekly", hire: "2024-06-10", dob: "2001-03-19", days: [4, 5, 6], hours: 6 },
  { code: "HHL-010", first: "Keisha", last: "Maduro", dept: "FB", position: "Sous Chef", manager: "HHL-005", payType: "salary", amount: 3100, basis: "monthly", freq: "monthly", hire: "2020-10-26", dob: "1988-08-08", raise: { from: "MIDPREV", amount: 3500, reason: "Promotion to Head Chef", position: "Head Chef" } },
  { code: "HHL-011", first: "Trevor", last: "Lettsome", dept: "FO", position: "Front Office Manager", manager: "HHL-001", payType: "salary", amount: 3800, basis: "monthly", freq: "monthly", hire: "2018-02-19", dob: "1981-12-04" },
  { code: "HHL-012", first: "Nadia", last: "Smith", dept: "FO", position: "Guest Services Agent", manager: "HHL-011", payType: "hourly", amount: 13.25, basis: "hourly", freq: "biweekly", hire: "2022-09-12", dob: "1997-06-21", days: [1, 2, 3, 4, 5, 6], hours: 6.5 },
  { code: "HHL-013", first: "Owen", last: "Malone", dept: "FO", position: "Night Auditor", manager: "HHL-011", payType: "salary", amount: 2450, basis: "monthly", freq: "monthly", hire: "2021-03-01", dob: "1987-10-30" },
  { code: "HHL-014", first: "Gloria", last: "Turnbull", dept: "HK", position: "Housekeeping Manager", manager: "HHL-001", payType: "salary", amount: 3300, basis: "monthly", freq: "monthly", hire: "2015-11-02", dob: "1970-04-11" },
  { code: "HHL-015", first: "Rosa", last: "Mendez", dept: "HK", position: "Room Attendant", manager: "HHL-014", payType: "hourly", amount: 11, basis: "hourly", freq: "biweekly", hire: "2023-01-09", dob: "1992-02-14" },
  { code: "HHL-016", first: "Lionel", last: "Pickering", dept: "HK", position: "Room Attendant", manager: "HHL-014", payType: "hourly", amount: 11, basis: "hourly", freq: "biweekly", hire: "2019-07-15", dob: "1959-07-07" },
  { code: "HHL-017", first: "Cheryl", last: "Harrigan", dept: "HK", position: "Laundry Attendant", manager: "HHL-014", payType: "hourly", amount: 10.75, basis: "hourly", freq: "biweekly", hire: "2024-03-04", dob: "1999-12-22" },
  { code: "HHL-018", first: "Andre", last: "Skelton", dept: "MNT", position: "Maintenance Supervisor", manager: "HHL-001", payType: "salary", amount: 3000, basis: "monthly", freq: "monthly", hire: "2017-09-18", dob: "1980-01-15" },
  { code: "HHL-019", first: "Wesley", last: "George", dept: "MNT", position: "Maintenance Technician", manager: "HHL-018", payType: "hourly", amount: 16, basis: "hourly", freq: "biweekly", hire: "2021-11-08", dob: "1990-05-25" },
  { code: "HHL-020", first: "Simone", last: "Durand", dept: "SAL", position: "Sales & Events Manager", manager: "HHL-001", payType: "salary", amount: 4500, basis: "monthly", freq: "monthly", hire: "2022-04-04", dob: "1986-03-08" },
  { code: "HHL-021", first: "Kyle", last: "Fahie", dept: "SAL", position: "Sales Coordinator", manager: "HHL-020", payType: "salary", amount: 2700, basis: "monthly", freq: "monthly", hire: "ANNIV1", dob: "BDAY2" },
  { code: "HHL-022", first: "Tamara", last: "Leonard", dept: "HR", position: "HR Assistant", manager: "HHL-002", payType: "salary", amount: 2400, basis: "monthly", freq: "monthly", hire: "2025-02-17", dob: "1999-09-30" },
  { code: "HHL-023", first: "Jordan", last: "Blyden", dept: "FIN", position: "Accounts Assistant", manager: "HHL-003", payType: "salary", amount: 2600, basis: "monthly", freq: "monthly", hire: "RECENT", dob: "2000-06-05" },
  { code: "HHL-024", first: "Elise", last: "Rhymer", dept: "FO", position: "Guest Experience Coordinator", manager: "HHL-011", payType: "salary", amount: 2500, basis: "monthly", freq: "monthly", hire: "FUTURE", dob: "1993-04-29", status: "onboarding" },
];

const TMS: EmpSpec[] = [
  { code: "TMS-001", first: "Victor", last: "Creque", dept: "OFF", position: "Managing Director", payType: "salary", amount: 7000, basis: "monthly", freq: "semi_monthly", hire: "2014-05-05", dob: "1968-10-21" },
  { code: "TMS-002", first: "Lorna", last: "Callwood", dept: "OFF", position: "Office Manager", manager: "TMS-001", payType: "salary", amount: 52000, basis: "annual", freq: "semi_monthly", hire: "2016-09-12", dob: "1977-03-03" },
  { code: "TMS-003", first: "Ian", last: "Rabsatt", dept: "WKS", position: "Workshop Foreman", manager: "TMS-001", payType: "salary", amount: 4800, basis: "monthly", freq: "semi_monthly", hire: "2015-02-02", dob: "1975-08-19" },
  { code: "TMS-004", first: "Deon", last: "O'Neal", dept: "WKS", position: "Marine Mechanic", manager: "TMS-003", payType: "hourly", amount: 22, basis: "hourly", freq: "semi_monthly", hire: "2018-06-04", dob: "1984-12-01" },
  { code: "TMS-005", first: "Ruben", last: "Chalwell", dept: "WKS", position: "Marine Mechanic", manager: "TMS-003", payType: "hourly", amount: 21, basis: "hourly", freq: "semi_monthly", hire: "2020-03-16", dob: "1989-04-07" },
  { code: "TMS-006", first: "Akeem", last: "Thomas", dept: "WKS", position: "Apprentice Mechanic", manager: "TMS-003", payType: "hourly", amount: 12.5, basis: "hourly", freq: "semi_monthly", hire: "2025-08-18", dob: "2007-01-11" },
  { code: "TMS-007", first: "Brianna", last: "Joseph", dept: "WKS", position: "Fibreglass Technician", manager: "TMS-003", payType: "hourly", amount: 18, basis: "hourly", freq: "semi_monthly", hire: "2021-01-11", dob: "1993-10-25" },
  { code: "TMS-008", first: "Caleb", last: "Donovan", dept: "OPS", position: "Operations Manager", manager: "TMS-001", payType: "salary", amount: 5200, basis: "monthly", freq: "semi_monthly", hire: "2017-04-03", dob: "1982-06-14" },
  { code: "TMS-009", first: "Mireille", last: "Baptiste", dept: "OPS", position: "Charter Coordinator", manager: "TMS-008", payType: "salary", amount: 3200, basis: "monthly", freq: "semi_monthly", hire: "2022-01-17", dob: "1995-02-09" },
  { code: "TMS-010", first: "Garth", last: "Isaac", dept: "OPS", position: "Captain", manager: "TMS-008", payType: "salary", amount: 4400, basis: "monthly", freq: "semi_monthly", hire: "2019-05-20", dob: "1978-11-30" },
  { code: "TMS-011", first: "Selwyn", last: "Morton", dept: "OPS", position: "Deckhand", manager: "TMS-010", payType: "hourly", amount: 13, basis: "hourly", freq: "semi_monthly", hire: "2023-03-06", dob: "2000-07-18" },
  { code: "TMS-012", first: "Paula", last: "Matthew", dept: "OPS", position: "Deckhand", manager: "TMS-010", type: "part_time", payType: "hourly", amount: 13, basis: "hourly", freq: "semi_monthly", hire: "2024-04-08", dob: "2002-09-27", days: [5, 6, 0], hours: 8 },
  { code: "TMS-013", first: "Hugo", last: "Lindqvist", dept: "WKS", position: "Rigger", manager: "TMS-003", type: "contract", payType: "hourly", amount: 28, basis: "hourly", freq: "semi_monthly", hire: "2025-11-03", dob: "1986-05-12" },
  { code: "TMS-014", first: "Nia", last: "Scatliffe", dept: "OFF", position: "Bookkeeper", manager: "TMS-002", type: "part_time", payType: "salary", amount: 1800, basis: "monthly", freq: "semi_monthly", hire: "2023-09-04", dob: "1991-01-16", days: [1, 3, 5], hours: 7 },
];

const CPA: EmpSpec[] = [
  { code: "CPA-001", first: "Evelyn", last: "Sutton", dept: "ADV", position: "Principal", payType: "salary", amount: 120000, basis: "annual", freq: "monthly", hire: "2019-01-07", dob: "1972-06-02" },
  { code: "CPA-002", first: "Rohan", last: "Chinnery", dept: "ADV", position: "Senior Consultant", manager: "CPA-001", payType: "salary", amount: 84000, basis: "annual", freq: "monthly", hire: "2020-02-03", dob: "1984-10-09" },
  { code: "CPA-003", first: "Imani", last: "Glasgow", dept: "ADV", position: "Consultant", manager: "CPA-001", payType: "salary", amount: 60000, basis: "annual", freq: "monthly", hire: "2022-08-15", dob: "1992-03-23" },
  { code: "CPA-004", first: "Felix", last: "Moreau", dept: "ADV", position: "Analyst", manager: "CPA-002", payType: "salary", amount: 48000, basis: "annual", freq: "monthly", hire: "2023-10-02", dob: "1997-12-11" },
  { code: "CPA-005", first: "Grace", last: "Lake", dept: "OPS", position: "Office Administrator", manager: "CPA-001", payType: "salary", amount: 38000, basis: "annual", freq: "monthly", hire: "2021-05-10", dob: "1988-07-14" },
  { code: "CPA-006", first: "Tobias", last: "Wynter", dept: "ADV", position: "Junior Analyst", manager: "CPA-002", type: "temporary", payType: "salary", amount: 3000, basis: "monthly", freq: "monthly", hire: "2026-06-01", dob: "2002-04-04" },
];

const HOLIDAYS_2026 = [
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-03-02", name: "Lavity Stoutt's Birthday" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-04-06", name: "Easter Monday" },
  { date: "2026-05-25", name: "Whit Monday" },
  { date: "2026-06-12", name: "Sovereign's Birthday" },
  { date: "2026-07-06", name: "Virgin Islands Day" },
  { date: "2026-08-03", name: "Emancipation Monday" },
  { date: "2026-08-04", name: "Emancipation Tuesday" },
  { date: "2026-08-05", name: "Emancipation Wednesday" },
  { date: "2026-10-21", name: "Heroes and Forefathers Day" },
  { date: "2026-12-25", name: "Christmas Day" },
  { date: "2026-12-26", name: "Boxing Day" },
  { date: "2027-01-01", name: "New Year's Day" },
];

export interface DemoSeed {
  state: RepositoryState;
  blobs: Map<string, Uint8Array>;
}

/** Build the full demo dataset for the given "today". */
export async function buildDemoSeed(today: ISODate): Promise<DemoSeed> {
  const ids: IdGenerator = sequentialIds("d");
  const rand = prng(20261005);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  let clock = new Date(`${today}T08:00:00.000Z`);
  const setClock = (d: ISODate, hour = 9) => {
    clock = new Date(`${d}T${String(hour).padStart(2, "0")}:${String(Math.floor(rand() * 50) + 5).padStart(2, "0")}:00.000Z`);
  };
  const iso = () => clock.toISOString();
  const repo = new InMemoryRepository();
  const storage = new MemoryDocumentStorage();
  const blobs = new Map<string, Uint8Array>();

  setClock("2026-01-02");
  const org: Organization = { id: ids("org"), name: "Seabright Group (Demo)", kind: "demo", createdAt: iso(), updatedAt: iso() };
  await repo.organizations.insert(org);
  const roles = await provisionRoles(repo, ids, iso(), org.id);
  const role = (key: string) => roles.find((r) => r.key === key)!.id;

  // Relative dates
  const thisMonthStart = startOfMonth(today);
  const anniv1 = addDays(addMonths(today, -12), 8);
  const bday2 = `${yearOf(today) - 31}-${addDays(today, 2).slice(5)}`;
  const recent = addDays(today, -14);
  const future = addDays(today, 10);
  const midPrev = `${addMonths(thisMonthStart, -1).slice(0, 7)}-16`;
  const resolveDate = (d: ISODate) => (d === "ANNIV1" ? anniv1 : d === "BDAY2" ? bday2 : d === "RECENT" ? recent : d === "FUTURE" ? future : d === "MIDPREV" ? midPrev : d);

  const companies: { company: Company; specs: EmpSpec[]; depts: Record<string, string>; byCode: Map<string, Employee> }[] = [];

  async function createCompany(
    profile: Parameters<typeof provisionCompany>[4],
    calendars: Company["payCalendars"],
    departments: [string, string][],
    specs: EmpSpec[],
    employer: Company["employerIds"],
    address: Company["address"],
  ) {
    const { company } = await provisionCompany(repo, ids, iso(), org.id, profile, { statutoryStatus: "demo", calendarAnchor: "2026-01-05" });
    const updated = await repo.companies.update(company.id, { payCalendars: calendars, holidays: HOLIDAYS_2026, employerIds: employer, address, setup: { completedSteps: ["company_profile", "payroll_settings", "employees", "opening_balances", "account_mappings", "parallel_run", "go_live"], liveSince: "2026-01-01" } });
    const depts: Record<string, string> = {};
    for (const [code, name] of departments) {
      const dep: Department = { id: ids("dept"), companyId: company.id, code, name, parentId: null, createdAt: iso(), updatedAt: iso() };
      await repo.departments.insert(dep);
      depts[code] = dep.id;
    }
    const policy = (await repo.leavePolicies.list(company.id))[0];
    const byCode = new Map<string, Employee>();
    for (const s of specs) {
      const hire = resolveDate(s.hire);
      const dob = resolveDate(s.dob);
      const n = specs.indexOf(s) + 1;
      const e: Employee = {
        id: ids("emp"),
        companyId: company.id,
        employeeCode: s.code,
        firstName: s.first,
        lastName: s.last,
        preferredName: s.preferred ?? "",
        dateOfBirth: dob,
        email: `${s.first.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}.${s.last.toLowerCase().replace(/[^a-z]/g, "")}@example.com`,
        phone: `+1 284 555 ${String(1000 + n * 37 + specs.length).slice(-4)}`,
        address: { line1: `${10 + n * 3} ${pick(["Main Street", "Waterfront Drive", "Joe's Hill Road", "Purcell Estate", "Huntums Ghut", "Fat Hogs Bay Road", "Sea Cow's Bay"])}`, city: pick(["Road Town", "Road Town", "East End", "West End", "Cane Garden Bay"]), region: "Tortola", country: "British Virgin Islands" },
        emergencyContact: { name: `${pick(["Avery", "Jordan", "Casey", "Morgan", "Riley", "Quinn"])} ${s.last}`, relationship: pick(["Spouse", "Parent", "Sibling", "Partner"]), phone: `+1 284 555 ${String(5000 + n * 41).slice(-4)}` },
        statutoryIds: {
          socialSecurityNumber: s.code === "HHL-019" ? "" : `SS-${String(200000 + n * 1373 + specs.length * 11).slice(-6)}`,
          nhiNumber: `NHI-${String(70000 + n * 811 + specs.length).slice(-5)}`,
          taxId: `PT-${String(40000 + n * 97).slice(-5)}`,
        },
        status: s.status ?? "active",
        employmentType: s.type ?? "full_time",
        hireDate: hire,
        probationEndDate: addMonths(hire, 3),
        terminationDate: null,
        terminationReason: null,
        departmentId: depts[s.dept],
        position: s.raise?.position && resolveDate(s.raise.from) <= today ? s.raise.position : s.position,
        managerId: s.manager ? (byCode.get(s.manager)?.id ?? null) : null,
        workLocation: s.location ?? pick(["Road Town", "Road Town", "Road Town", "Nanny Cay"]),
        leavePolicyId: policy.id,
        payProfile: { payMethod: s.payType === "hourly" && n % 5 === 0 ? "cheque" : "bank_transfer", bankName: pick(["First Island Bank", "Harbour Savings", "Tortola Credit Union"]), bankAccount: `00${String(31000000 + n * 7919 + specs.length * 13).slice(-8)}` },
        notes: [],
        userId: null,
        createdAt: iso(),
        updatedAt: iso(),
      };
      await repo.employees.insert(e);
      byCode.set(s.code, e);
      const hireEvt: EmploymentEvent = { id: ids("evt"), companyId: company.id, employeeId: e.id, effectiveDate: hire, type: "hire", departmentId: e.departmentId, position: s.position, managerId: e.managerId, employmentType: e.employmentType, workLocation: e.workLocation, note: "Hired", createdBy: "system", createdAt: iso(), updatedAt: iso() };
      await repo.employmentEvents.insert(hireEvt);
      const schedule: WorkSchedule = { id: ids("sch"), companyId: company.id, employeeId: e.id, effectiveFrom: hire, workDays: s.days ?? MON_FRI, hoursPerDay: s.hours ?? 8, reason: "Initial schedule", createdBy: "system", createdAt: iso(), updatedAt: iso() };
      await repo.schedules.insert(schedule);
      // Starting rate ~ two years earlier was lower for long-tenured staff to give salary history.
      const startAmount = hire < "2024-01-01" ? Math.round(s.amount * (s.payType === "hourly" ? 0.94 : 0.92) * 100) / 100 : s.amount;
      const rate: PayRate = { id: ids("rate"), companyId: company.id, employeeId: e.id, effectiveFrom: hire, payType: s.payType, amount: startAmount, basis: s.basis, payFrequency: s.freq, reason: "Starting rate", createdBy: "system", createdAt: iso(), updatedAt: iso() };
      await repo.payRates.insert(rate);
      if (startAmount !== s.amount) {
        await repo.payRates.insert({ ...rate, id: ids("rate"), effectiveFrom: "2025-01-01", amount: s.amount, reason: "Annual review 2025", createdAt: iso(), updatedAt: iso() });
      }
      if (s.raise) {
        const from = resolveDate(s.raise.from);
        await repo.payRates.insert({ ...rate, id: ids("rate"), effectiveFrom: from, amount: s.raise.amount, reason: s.raise.reason, createdAt: iso(), updatedAt: iso() });
        if (s.raise.position) {
          await repo.employmentEvents.insert({ ...hireEvt, id: ids("evt"), effectiveDate: from, type: "promotion", position: s.raise.position, note: s.raise.reason });
        }
      }
    }
    // Resolve managers declared later in the list
    for (const s of specs) {
      if (!s.manager) continue;
      const e = byCode.get(s.code)!;
      const m = byCode.get(s.manager)!;
      if (e.managerId !== m.id) {
        await repo.employees.update(company.id, e.id, { managerId: m.id });
        e.managerId = m.id;
      }
    }
    companies.push({ company: updated, specs, depts, byCode });
    return { company: updated, byCode, depts };
  }

  const hhl = await createCompany(
    { legalName: "Harbourview Hospitality Ltd.", tradingName: "Harbourview Hotel", shortName: "HHL", accentColor: "#1f5c4d", contactEmail: "office@harbourview.example.com", contactPhone: "+1 284 555 0100", registrationNumber: "BVI-1849302", payFrequency: "monthly" },
    [
      { frequency: "monthly", anchorDate: "2026-01-01", payDateOffsetDays: -1, active: true },
      { frequency: "biweekly", anchorDate: "2026-01-05", payDateOffsetDays: 5, active: true },
    ],
    [["EXE", "Executive"], ["FO", "Front Office"], ["FB", "Food & Beverage"], ["HK", "Housekeeping"], ["FIN", "Finance"], ["HR", "Human Resources"], ["MNT", "Maintenance"], ["SAL", "Sales & Events"]],
    HHL,
    { socialSecurity: "ER-SS-104422", nhi: "ER-NHI-55318", payrollTax: "ER-PT-77310" },
    { line1: "1 Waterfront Drive", city: "Road Town", region: "Tortola", postalCode: "VG1110", country: "British Virgin Islands" },
  );
  const tms = await createCompany(
    { legalName: "Tortola Marine Services Ltd.", tradingName: "Tortola Marine", shortName: "TMS", accentColor: "#2c4f7c", contactEmail: "accounts@tortolamarine.example.com", contactPhone: "+1 284 555 0200", registrationNumber: "BVI-2210587", payFrequency: "semi_monthly" },
    [{ frequency: "semi_monthly", anchorDate: "2026-01-01", payDateOffsetDays: 0, active: true }],
    [["OFF", "Office"], ["WKS", "Workshop"], ["OPS", "Charter Operations"]],
    TMS,
    { socialSecurity: "ER-SS-208815", nhi: "ER-NHI-61902", payrollTax: "ER-PT-80144" },
    { line1: "Nanny Cay Marina, Unit 7", city: "Nanny Cay", region: "Tortola", postalCode: "VG1110", country: "British Virgin Islands" },
  );
  const cpa = await createCompany(
    { legalName: "Cedar Point Advisory Inc.", tradingName: "Cedar Point Advisory", shortName: "CPA", accentColor: "#6b4e2e", contactEmail: "hello@cedarpoint.example.com", contactPhone: "+1 284 555 0300", registrationNumber: "BVI-3007741", payFrequency: "monthly" },
    [{ frequency: "monthly", anchorDate: "2026-01-01", payDateOffsetDays: -2, active: true }],
    [["ADV", "Advisory"], ["OPS", "Operations"]],
    CPA,
    { socialSecurity: "ER-SS-310076", nhi: "ER-NHI-70013", payrollTax: "ER-PT-90551" },
    { line1: "Cedar Point Building, 3rd Floor", city: "Road Town", region: "Tortola", postalCode: "VG1110", country: "British Virgin Islands" },
  );

  // ------------------------------------------------------------------ Users
  const H = (code: string) => hhl.byCode.get(code)!;
  const mkUser = async (email: string, name: string, memberships: User["memberships"]) => {
    const u: User = { id: ids("usr"), organizationId: org.id, email, name, status: "active", memberships, lastLoginAt: null, passwordHash: null, twoFactor: null, createdAt: iso(), updatedAt: iso() };
    await repo.users.insert(u);
    for (const m of memberships) if (m.employeeId) await repo.employees.update(m.companyId, m.employeeId, { userId: u.id });
    return u;
  };
  const admin = await mkUser("demo.admin@example.com", "Morgan Reid", [
    { companyId: hhl.company.id, roleId: role("owner"), scope: "all", employeeId: null },
    { companyId: tms.company.id, roleId: role("owner"), scope: "all", employeeId: null },
    { companyId: cpa.company.id, roleId: role("owner"), scope: "all", employeeId: null },
  ]);
  await mkUser("demo.hr@example.com", "Renée Faulkner", [
    { companyId: hhl.company.id, roleId: role("hr_manager"), scope: "all", employeeId: H("HHL-002").id },
    { companyId: tms.company.id, roleId: role("hr_manager"), scope: "all", employeeId: null },
  ]);
  const payrollUser = await mkUser("demo.payroll@example.com", "Alana Christopher", [
    { companyId: hhl.company.id, roleId: role("payroll_officer"), scope: "all", employeeId: H("HHL-004").id },
    { companyId: tms.company.id, roleId: role("payroll_officer"), scope: "all", employeeId: null },
    { companyId: cpa.company.id, roleId: role("payroll_officer"), scope: "all", employeeId: null },
  ]);
  await mkUser("demo.supervisor@example.com", "Kervin Stoutt", [{ companyId: hhl.company.id, roleId: role("supervisor"), scope: "team", employeeId: H("HHL-005").id }]);
  await mkUser("demo.employee@example.com", "Shanice Penn", [{ companyId: hhl.company.id, roleId: role("employee"), scope: "self", employeeId: H("HHL-006").id }]);
  await mkUser("demo.accountant@example.com", "Priya Ellis", [
    { companyId: hhl.company.id, roleId: role("accountant"), scope: "all", employeeId: null },
    { companyId: tms.company.id, roleId: role("accountant"), scope: "all", employeeId: null },
    { companyId: cpa.company.id, roleId: role("accountant"), scope: "all", employeeId: null },
  ]);

  await repo.licenses.upsert({ id: ids("lic"), organizationId: org.id, plan: "demo", status: "active", features: [], employeeLimit: null, createdAt: iso(), updatedAt: iso() });

  // ------------------------------------------------------------------ Leave ledger
  const year = yearOf(today);
  for (const { company, byCode } of companies) {
    const types = await repo.leaveTypes.list(company.id);
    const policy = (await repo.leavePolicies.list(company.id))[0];
    const entries: LeaveLedgerEntry[] = [];
    for (const e of byCode.values()) {
      if (e.hireDate > today) continue;
      for (const rule of policy.rules) {
        const startMonth = yearOf(e.hireDate) === year ? monthOf(e.hireDate) : 1;
        const amount = Math.round(((rule.annualEntitlement * (12 - startMonth + 1)) / 12) * 2) / 2;
        if (amount > 0) entries.push({ id: ids("lvl"), companyId: company.id, employeeId: e.id, leaveTypeId: rule.leaveTypeId, date: yearOf(e.hireDate) === year ? e.hireDate : `${year}-01-01`, amount, kind: "allocation", reason: `${year} entitlement`, requestId: null, createdBy: "system", createdAt: iso(), updatedAt: iso() });
        const vac = types.find((t) => t.id === rule.leaveTypeId)?.code === "VAC";
        if (vac && yearOf(e.hireDate) < year && rand() < 0.6) {
          entries.push({ id: ids("lvl"), companyId: company.id, employeeId: e.id, leaveTypeId: rule.leaveTypeId, date: `${year}-01-01`, amount: Math.min(rule.carryForwardMax, Math.round(rand() * 5 * 2) / 2 + 0.5), kind: "carry_forward", reason: `Carried forward from ${year - 1}`, requestId: null, createdBy: "system", createdAt: iso(), updatedAt: iso() });
        }
      }
    }
    await repo.leaveLedger.insertMany(entries);
  }

  // ------------------------------------------------------------------ Leave requests
  async function addLeave(companyId: string, e: Employee, code: string, start: ISODate, end: ISODate, status: LeaveRequest["status"], reason: string, decidedById: string | null) {
    const company = (await repo.companies.get(companyId))!;
    const type = (await repo.leaveTypes.list(companyId)).find((t) => t.code === code)!;
    const schedules = await repo.schedules.list(companyId, { where: { employeeId: e.id } });
    const { quantity } = leaveQuantity({ startDate: start, endDate: end }, type, schedules, company.holidays);
    if (quantity <= 0) return;
    const req: LeaveRequest = { id: ids("lvr"), companyId, employeeId: e.id, leaveTypeId: type.id, startDate: start, endDate: end, hours: null, quantity, unit: type.unit, reason, status, decidedBy: status === "pending" ? null : decidedById, decidedAt: status === "pending" ? null : `${addDays(start, -7)}T14:10:00.000Z`, decisionNote: status === "rejected" ? "Peak occupancy week — please choose other dates." : null, createdBy: e.userId ?? decidedById ?? "system", createdAt: `${addDays(start, -12)}T10:00:00.000Z`, updatedAt: iso() };
    await repo.leaveRequests.insert(req);
    if (status === "approved" && type.tracksBalance) {
      await repo.leaveLedger.insert({ id: ids("lvl"), companyId, employeeId: e.id, leaveTypeId: type.id, date: start, amount: -quantity, kind: "taken", reason: `${type.name} ${formatDate(start)} – ${formatDate(end)}`, requestId: req.id, createdBy: decidedById ?? "system", createdAt: iso(), updatedAt: iso() });
    }
  }
  const hrUserId = (await repo.users.getByEmail("demo.hr@example.com"))!.id;
  const prevMonth = addMonths(thisMonthStart, -1);
  const prev2 = addMonths(thisMonthStart, -2);
  const nextWorkday = (d: ISODate) => {
    let x = d;
    while (dayOfWeek(x) === 0 || dayOfWeek(x) === 6) x = addDays(x, 1);
    return x;
  };
  // Past, already-paid leave
  await addLeave(hhl.company.id, H("HHL-011"), "VAC", nextWorkday(addDays(prev2, 9)), addDays(nextWorkday(addDays(prev2, 9)), 4), "approved", "Family trip", hrUserId);
  await addLeave(hhl.company.id, H("HHL-014"), "VAC", nextWorkday(addDays(prev2, 2)), addDays(nextWorkday(addDays(prev2, 2)), 2), "approved", "", hrUserId);
  await addLeave(hhl.company.id, H("HHL-013"), "USICK", nextWorkday(addDays(prevMonth, 8)), addDays(nextWorkday(addDays(prevMonth, 8)), 1), "approved", "Sick — sick leave exhausted", hrUserId);
  await addLeave(hhl.company.id, H("HHL-003"), "SICK", nextWorkday(addDays(prevMonth, 14)), nextWorkday(addDays(prevMonth, 14)), "approved", "Medical appointment", hrUserId);
  await addLeave(hhl.company.id, H("HHL-020"), "VAC", nextWorkday(addDays(prevMonth, 20)), addDays(nextWorkday(addDays(prevMonth, 20)), 1), "approved", "", hrUserId);
  await addLeave(hhl.company.id, H("HHL-012"), "VAC", nextWorkday(addDays(prevMonth, 3)), addDays(nextWorkday(addDays(prevMonth, 3)), 2), "rejected", "Long weekend", hrUserId);
  // Current period: approved unpaid sick leave that must flow into this month's payroll
  const usickStart = nextWorkday(thisMonthStart);
  await addLeave(hhl.company.id, H("HHL-006"), "USICK", usickStart, nextWorkday(addDays(usickStart, 1)), "approved", "Unwell — paid sick leave already used", hrUserId);
  // Pending requests (supervisor's team and others)
  await addLeave(hhl.company.id, H("HHL-010"), "VAC", nextWorkday(addDays(today, 14)), addDays(nextWorkday(addDays(today, 14)), 4), "pending", "Visiting family in St Kitts", null);
  await addLeave(hhl.company.id, H("HHL-007"), "VAC", nextWorkday(addDays(today, 28)), addDays(nextWorkday(addDays(today, 28)), 2), "pending", "", null);
  await addLeave(hhl.company.id, H("HHL-008"), "UNPAID", nextWorkday(addDays(today, 9)), nextWorkday(addDays(today, 9)), "pending", "Exam day", null);
  await addLeave(hhl.company.id, H("HHL-019"), "VAC", nextWorkday(addDays(today, 20)), addDays(nextWorkday(addDays(today, 20)), 1), "pending", "", null);
  await addLeave(hhl.company.id, H("HHL-001"), "VAC", nextWorkday(addDays(today, 40)), addDays(nextWorkday(addDays(today, 40)), 4), "approved", "Annual leave", hrUserId);
  const T = (code: string) => tms.byCode.get(code)!;
  await addLeave(tms.company.id, T("TMS-009"), "VAC", nextWorkday(addDays(today, 6)), addDays(nextWorkday(addDays(today, 6)), 1), "pending", "", null);
  await addLeave(tms.company.id, T("TMS-005"), "SICK", nextWorkday(addDays(prevMonth, 10)), nextWorkday(addDays(prevMonth, 10)), "approved", "", hrUserId);
  await addLeave(tms.company.id, T("TMS-010"), "UNPAID", nextWorkday(addDays(prevMonth, 22)), nextWorkday(addDays(prevMonth, 23)), "approved", "Personal matter", hrUserId);

  // ------------------------------------------------------------------ Timesheets
  const tsRows: TimesheetEntry[] = [];
  const approverId = payrollUser.id;
  for (const { company, byCode } of companies) {
    const holidays = new Set(company.holidays.map((h) => h.date));
    const approvedLeave = await repo.leaveRequests.list(company.id, { where: { status: "approved" } });
    const from = company.id === hhl.company.id ? addDays(startOfMonth(addMonths(today, -3)), -14) : addDays(startOfMonth(addMonths(today, -2)), -1);
    for (const e of byCode.values()) {
      const rate = effectiveOn(await repo.payRates.list(company.id, { where: { employeeId: e.id } }), today);
      const sched = (await repo.schedules.list(company.id, { where: { employeeId: e.id } }))[0];
      const hourly = rate?.payType === "hourly";
      const nightAuditor = e.employeeCode === "HHL-013";
      if (!hourly && !nightAuditor && e.employeeCode !== "TMS-010") continue;
      for (const day of eachDay(from, addDays(today, -1))) {
        if (day < e.hireDate || !isScheduledDay(day, sched.workDays) || holidays.has(day)) continue;
        if (approvedLeave.some((l) => l.employeeId === e.id && l.startDate <= day && l.endDate >= day)) continue;
        const current = day >= periodContaining({ frequency: rate!.payFrequency, anchorDate: "2026-01-05", payDateOffsetDays: 0, active: true }, today).start;
        const status: TimesheetEntry["status"] = current ? "submitted" : "approved";
        let overtime = 0;
        if (hourly && rand() < 0.12) overtime = pick([1, 1.5, 2, 3]);
        if (!hourly && rand() < 0.15) overtime = pick([2, 3, 4]);
        if (!hourly && overtime === 0) continue;
        const absent = hourly && rand() < 0.015;
        tsRows.push({
          id: ids("ts"),
          companyId: company.id,
          employeeId: e.id,
          date: day,
          scheduledHours: sched.hoursPerDay,
          workedHours: absent ? 0 : hourly ? sched.hoursPerDay - (rand() < 0.05 ? 1 : 0) : sched.hoursPerDay,
          overtimeHours: absent ? 0 : overtime,
          lateMinutes: !absent && rand() < 0.06 ? pick([5, 10, 15, 25]) : 0,
          absent,
          status,
          source: "manual",
          note: absent ? "No call, no show" : overtime ? pick(["Event coverage", "Covering shift", "Inventory count", "Late check-ins"]) : "",
          approvedBy: status === "approved" ? approverId : null,
          approvedAt: status === "approved" ? `${addDays(day, 3)}T15:00:00.000Z` : null,
          createdAt: `${day}T22:00:00.000Z`,
          updatedAt: `${day}T22:00:00.000Z`,
        });
      }
    }
  }
  await repo.timesheets.insertMany(tsRows);
  // A pending attendance correction from a supervisor's team member
  const corr: AttendanceCorrection = { id: ids("atc"), companyId: hhl.company.id, employeeId: H("HHL-007").id, entryId: null, date: nextWorkday(addDays(today, -6)), requestedWorkedHours: 8, requestedOvertimeHours: 2, reason: "Stayed late for the Harbour Gala banquet; clock-out was missed.", status: "pending", requestedBy: H("HHL-007").id, createdAt: iso(), updatedAt: iso() };
  const existingTs = tsRows.find((t) => t.employeeId === corr.employeeId && t.date === corr.date);
  corr.entryId = existingTs?.id ?? null;
  await repo.attendanceCorrections.insert(corr);

  // ------------------------------------------------------------------ Pay items & loans
  const items: [Company, Employee, Partial<PayItem>][] = [
    [hhl.company, H("HHL-001"), { kind: "earning", category: "allowance", label: "Housing allowance", amount: 1500, taxable: true }],
    [hhl.company, H("HHL-003"), { kind: "earning", category: "allowance", label: "Housing allowance", amount: 800, taxable: true }],
    [hhl.company, H("HHL-011"), { kind: "earning", category: "allowance", label: "Transport allowance", amount: 150, taxable: false }],
    [hhl.company, H("HHL-020"), { kind: "earning", category: "commission", label: "Events commission (base)", amount: 600, taxable: true }],
    [hhl.company, H("HHL-001"), { kind: "deduction", category: "pension", label: "Pension (5%)", method: "percent_of_base", amount: 0.05, pretax: true }],
    [hhl.company, H("HHL-002"), { kind: "deduction", category: "pension", label: "Pension (5%)", method: "percent_of_base", amount: 0.05, pretax: true }],
    [hhl.company, H("HHL-003"), { kind: "deduction", category: "health", label: "Group health plan", amount: 85, pretax: true }],
    [hhl.company, H("HHL-005"), { kind: "deduction", category: "health", label: "Group health plan", amount: 85, pretax: true }],
    [hhl.company, H("HHL-014"), { kind: "deduction", category: "union", label: "Staff association dues", amount: 15, pretax: false }],
    [tms.company, T("TMS-003"), { kind: "earning", category: "allowance", label: "Tool allowance", amount: 75, taxable: true }],
    [tms.company, T("TMS-010"), { kind: "earning", category: "allowance", label: "Captain's licence allowance", amount: 200, taxable: true }],
    [tms.company, T("TMS-008"), { kind: "deduction", category: "health", label: "Group health plan", amount: 42.5, pretax: true }],
    [cpa.company, cpa.byCode.get("CPA-002")!, { kind: "deduction", category: "pension", label: "Pension (6%)", method: "percent_of_base", amount: 0.06, pretax: true }],
    [cpa.company, cpa.byCode.get("CPA-003")!, { kind: "earning", category: "allowance", label: "Professional membership", amount: 50, taxable: false }],
  ];
  for (const [company, e, p] of items) {
    await repo.payItems.insert({ id: ids("item"), companyId: company.id, employeeId: e.id, kind: "earning", category: "other", label: "", method: "fixed", amount: 0, taxable: false, pretax: false, startDate: "2025-01-01", endDate: null, active: true, createdAt: iso(), updatedAt: iso(), ...p } as PayItem);
  }
  const loans: [Company, Employee, Partial<Loan>][] = [
    [hhl.company, H("HHL-015"), { type: "loan", reference: "LN-0001", principal: 1500, installment: 125, issuedDate: addMonths(thisMonthStart, -4), startDate: addMonths(thisMonthStart, -3), note: "Car repair loan" }],
    [hhl.company, H("HHL-007"), { type: "advance", reference: "ADV-0002", principal: 600, installment: 100, issuedDate: addMonths(thisMonthStart, -2), startDate: addDays(addMonths(thisMonthStart, -2), 10), note: "Salary advance — school fees" }],
    [hhl.company, H("HHL-013"), { type: "advance", reference: "ADV-0003", principal: 400, installment: 200, issuedDate: addMonths(thisMonthStart, -3), startDate: addMonths(thisMonthStart, -2), note: "Emergency advance" }],
    [tms.company, T("TMS-004"), { type: "loan", reference: "LN-0001", principal: 2000, installment: 200, issuedDate: addMonths(thisMonthStart, -3), startDate: addMonths(thisMonthStart, -2), note: "Relocation loan" }],
  ];
  for (const [company, e, p] of loans) {
    await repo.loans.insert({ id: ids("loan"), companyId: company.id, employeeId: e.id, status: "active", manualRepayments: [], createdAt: iso(), updatedAt: iso(), ...p } as Loan);
  }

  // ------------------------------------------------------------------ Documents
  const docs: { company: Company; e: Employee | null; category: EmployeeDocument["category"]; title: string; expiry?: ISODate; visibility?: EmployeeDocument["visibility"] }[] = [
    { company: hhl.company, e: null, category: "policy", title: "Employee handbook 2026", visibility: "employee" },
    { company: hhl.company, e: H("HHL-006"), category: "contract", title: "Employment contract", visibility: "employee" },
    { company: hhl.company, e: H("HHL-006"), category: "certification", title: "Food handler certificate", expiry: addDays(today, 170), visibility: "employee" },
    { company: hhl.company, e: H("HHL-019"), category: "work_permit", title: "Work permit", expiry: addDays(today, 18) },
    { company: hhl.company, e: H("HHL-012"), category: "certification", title: "First aid certificate", expiry: addDays(today, 26), visibility: "employee" },
    { company: hhl.company, e: H("HHL-010"), category: "certification", title: "Food safety supervisor certificate", expiry: addDays(today, 63) },
    { company: hhl.company, e: H("HHL-015"), category: "identification", title: "Passport copy", expiry: addDays(today, 410) },
    { company: hhl.company, e: H("HHL-023"), category: "contract", title: "Employment contract", visibility: "employee" },
    { company: hhl.company, e: H("HHL-001"), category: "contract", title: "Executive employment agreement" },
    { company: tms.company, e: T("TMS-013"), category: "work_permit", title: "Work permit", expiry: addDays(today, -9) },
    { company: tms.company, e: T("TMS-010"), category: "certification", title: "Master's licence (200GT)", expiry: addDays(today, 22) },
    { company: tms.company, e: T("TMS-004"), category: "contract", title: "Employment contract" },
    { company: cpa.company, e: cpa.byCode.get("CPA-006")!, category: "contract", title: "Fixed-term contract", expiry: addDays(today, 57) },
  ];
  for (const d of docs) {
    const id = ids("doc");
    const bytes = minimalPdf([d.title, d.company.legalName, d.e ? `${d.e.firstName} ${d.e.lastName} (${d.e.employeeCode})` : "Company document", "DEMO DOCUMENT - synthetic content for evaluation only.", d.expiry ? `Expires: ${formatDate(d.expiry)}` : ""]);
    const key = `${d.company.id}/${id}`;
    await storage.put(key, bytes);
    blobs.set(key, bytes);
    await repo.documents.insert({ id, companyId: d.company.id, employeeId: d.e?.id ?? null, category: d.category, title: d.title, fileName: `${d.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`, mimeType: "application/pdf", size: bytes.length, checksum: await sha256Hex(bytes), storageKey: key, expiryDate: d.expiry ?? null, visibility: d.visibility ?? "hr", uploadedBy: hrUserId, uploadedByName: "Renée Faulkner", notes: "", createdAt: iso(), updatedAt: iso() });
  }

  // ------------------------------------------------------------------ Workflows
  const mkTasks = (template: typeof ONBOARDING_TEMPLATE, base: ISODate, doneCount: number) =>
    template.map((t, i) => ({ id: ids("task"), title: t.title, owner: t.owner, category: t.category, dueDate: addDays(base, t.offsetDays), done: i < doneCount, doneAt: i < doneCount ? `${addDays(base, Math.min(t.offsetDays, 0))}T12:00:00.000Z` : null, doneBy: i < doneCount ? hrUserId : null }));
  const wfs: Workflow[] = [
    { id: ids("wf"), companyId: hhl.company.id, employeeId: H("HHL-024").id, type: "onboarding", status: "in_progress", startDate: H("HHL-024").hireDate, tasks: mkTasks(ONBOARDING_TEMPLATE, H("HHL-024").hireDate, 2), createdBy: hrUserId, createdAt: iso(), updatedAt: iso() },
    { id: ids("wf"), companyId: hhl.company.id, employeeId: H("HHL-023").id, type: "onboarding", status: "in_progress", startDate: H("HHL-023").hireDate, tasks: mkTasks(ONBOARDING_TEMPLATE, H("HHL-023").hireDate, 7), createdBy: hrUserId, createdAt: iso(), updatedAt: iso() },
  ];
  const leaving = addDays(endOfMonth(today), 0);
  wfs.push({ id: ids("wf"), companyId: hhl.company.id, employeeId: H("HHL-022").id, type: "offboarding", status: "in_progress", startDate: addDays(today, -5), terminationDate: leaving, terminationReason: "Resigned — relocating overseas", tasks: mkTasks(OFFBOARDING_TEMPLATE, leaving, 2), createdBy: hrUserId, createdAt: iso(), updatedAt: iso() });
  for (const w of wfs) await repo.workflows.insert(w);
  await repo.employees.update(hhl.company.id, H("HHL-022").id, { terminationDate: leaving, terminationReason: "Resigned — relocating overseas" });
  await repo.employmentEvents.insert({ id: ids("evt"), companyId: hhl.company.id, employeeId: H("HHL-022").id, effectiveDate: leaving, type: "termination", note: "Resigned — relocating overseas", createdBy: hrUserId, createdAt: iso(), updatedAt: iso() });
  await repo.employmentEvents.insert({ id: ids("evt"), companyId: hhl.company.id, employeeId: H("HHL-013").id, effectiveDate: "2024-05-01", type: "transfer", departmentId: hhl.depts.FO, position: "Night Auditor", note: "Transferred from Finance", createdBy: hrUserId, createdAt: iso(), updatedAt: iso() });
  await repo.employmentEvents.insert({ id: ids("evt"), companyId: hhl.company.id, employeeId: H("HHL-006").id, effectiveDate: "2024-03-01", type: "promotion", position: "Restaurant Supervisor", note: "Promoted from Server", createdBy: hrUserId, createdAt: iso(), updatedAt: iso() });
  await repo.employees.update(hhl.company.id, H("HHL-002").id, {
    notes: [{ id: ids("note"), body: "Completed CIPD Level 5 in March. Discussed succession planning for HR Assistant role.", createdAt: `${year}-04-10T15:30:00.000Z`, createdBy: admin.id, createdByName: "Morgan Reid" }],
  });

  // ------------------------------------------------------------------ Payroll history (real engine + procedures)
  const ctxFor = async (userId: string, companyId: string): Promise<Ctx> => ({
    actor: await resolveActor(repo, userId, companyId),
    repo,
    storage,
    mode: "demo",
    entitlements: demoEntitlements(),
    now: () => clock,
    ids,
  });
  const call = async <N extends keyof typeof procedures>(ctx: Ctx, name: N, input: unknown) => execute(procedures[name] as never, ctx, input) as Promise<unknown>;

  async function runPayroll(companyId: string, period: PayPeriod, finalStatus: "locked" | "finalized" | "review", opts: { inputs?: { code: string; label: string; category: string; amount?: number; hours?: number; kind?: "earning" | "deduction" }[] } = {}) {
    setClock(addDays(period.payDate, -3), 10);
    const pctx = await ctxFor(payrollUser.id, companyId);
    const run = (await call(pctx, "payroll.runs.create", { type: "regular", payFrequency: period.frequency, periodStart: period.start, periodEnd: period.end, payDate: period.payDate })) as { id: string };
    const company = companies.find((c) => c.company.id === companyId)!;
    for (const inp of opts.inputs ?? []) {
      const e = company.byCode.get(inp.code)!;
      await call(pctx, "payroll.inputs.save", { runId: run.id, input: { employeeId: e.id, kind: inp.kind ?? "earning", category: inp.category, label: inp.label, amount: inp.amount ?? null, hours: inp.hours ?? null, taxable: true, pretax: false, note: "" } });
    }
    await call(pctx, "payroll.calculate", { runId: run.id });
    await call(pctx, "payroll.submitForReview", { runId: run.id });
    if (finalStatus === "review") return run.id;
    const r = await repo.payrollRuns.get(companyId, run.id);
    const warnings = r!.preflight.issues.filter((i) => i.severity === "warning").map((i) => i.id);
    if (warnings.length) await call(pctx, "payroll.acknowledge", { runId: run.id, issueIds: warnings, acknowledged: true });
    setClock(addDays(period.payDate, -2), 15);
    const actx = await ctxFor(admin.id, companyId);
    await call(actx, "payroll.approve", { runId: run.id, note: "Reviewed against timesheets and leave." });
    setClock(addDays(period.payDate, -1), 11);
    await call(actx, "payroll.finalize", { runId: run.id });
    if (finalStatus === "locked") {
      setClock(addDays(period.payDate, 2), 9);
      await call(actx, "payroll.lock", { runId: run.id });
    }
    return run.id;
  }

  // HHL monthly: last 4 complete months; HHL biweekly: periods since 3 months ago
  const hhlMonthly = hhl.company.payCalendars[0];
  const months: PayPeriod[] = [];
  let p = previousPeriod(hhlMonthly, periodContaining(hhlMonthly, today));
  for (let i = 0; i < 4; i++) {
    months.unshift(p);
    p = previousPeriod(hhlMonthly, p);
  }
  const monthRunIds: string[] = [];
  for (const [i, m] of months.entries()) {
    const inputs = i === months.length - 1
      ? [{ code: "HHL-020", label: "Q3 events commission", category: "commission", amount: 1250 }, { code: "HHL-005", label: "Performance bonus", category: "bonus", amount: 500 }]
      : i === 1
        ? [{ code: "HHL-021", label: "Sales incentive", category: "bonus", amount: 300 }]
        : [];
    monthRunIds.push(await runPayroll(hhl.company.id, m, i === months.length - 1 ? "finalized" : "locked", { inputs }));
  }
  const bw = hhl.company.payCalendars[1];
  const currentBw = periodContaining(bw, today);
  const bwPeriods: PayPeriod[] = [];
  let q = previousPeriod(bw, currentBw);
  while (q.start >= addDays(months[1].start, 0)) {
    bwPeriods.unshift(q);
    q = previousPeriod(bw, q);
  }
  for (const [i, period] of bwPeriods.entries()) {
    if (period.payDate > today) continue;
    await runPayroll(hhl.company.id, period, i === bwPeriods.length - 1 ? "finalized" : "locked");
  }

  // Correction against a locked monthly payroll
  {
    const target = monthRunIds[monthRunIds.length - 3];
    const tRun = (await repo.payrollRuns.get(hhl.company.id, target))!;
    setClock(addDays(tRun.payDate, 12), 10);
    const pctx = await ctxFor(payrollUser.id, hhl.company.id);
    const corrRun = (await call(pctx, "payroll.runs.create", { type: "correction", payFrequency: "monthly", periodStart: tRun.periodStart, periodEnd: tRun.periodEnd, payDate: addDays(tRun.payDate, 14), correctsRunId: target, correctionReason: "Night differential for 6 shifts was omitted from the original run.", employeeIds: [H("HHL-013").id] })) as { id: string };
    await call(pctx, "payroll.inputs.save", { runId: corrRun.id, input: { employeeId: H("HHL-013").id, kind: "earning", category: "adjustment", label: "Night differential (omitted)", amount: 180, taxable: true, pretax: false, note: "6 shifts × $30" } });
    await call(pctx, "payroll.calculate", { runId: corrRun.id });
    await call(pctx, "payroll.submitForReview", { runId: corrRun.id });
    const actx = await ctxFor(admin.id, hhl.company.id);
    const cr = (await repo.payrollRuns.get(hhl.company.id, corrRun.id))!;
    const warnings = cr.preflight.issues.filter((i) => i.severity === "warning").map((i) => i.id);
    if (warnings.length) await call(actx, "payroll.acknowledge", { runId: corrRun.id, issueIds: warnings, acknowledged: true });
    await call(actx, "payroll.approve", { runId: corrRun.id, note: "Correction verified against the night shift roster." });
    await call(actx, "payroll.finalize", { runId: corrRun.id });
    await call(actx, "payroll.lock", { runId: corrRun.id });
  }

  // TMS semi-monthly: 3 locked, latest in review with outstanding warnings
  const sm = tms.company.payCalendars[0];
  const smPeriods: PayPeriod[] = [];
  let r = previousPeriod(sm, periodContaining(sm, today));
  for (let i = 0; i < 4; i++) {
    smPeriods.unshift(r);
    r = previousPeriod(sm, r);
  }
  for (const [i, period] of smPeriods.entries()) {
    await runPayroll(tms.company.id, period, i === smPeriods.length - 1 ? "review" : "locked", i === smPeriods.length - 1 ? { inputs: [{ code: "TMS-010", label: "Charter tips pool", category: "bonus", amount: 340 }] } : {});
  }

  // CPA monthly: 3 runs
  const cm = cpa.company.payCalendars[0];
  const cmPeriods: PayPeriod[] = [];
  let s = previousPeriod(cm, periodContaining(cm, today));
  for (let i = 0; i < 3; i++) {
    cmPeriods.unshift(s);
    s = previousPeriod(cm, s);
  }
  for (const [i, period] of cmPeriods.entries()) await runPayroll(cpa.company.id, period, i === cmPeriods.length - 1 ? "finalized" : "locked");

  // Historical payroll for HHL January – start of engine history (imported totals)
  {
    setClock(`${year}-01-15`, 9);
    const actx = await ctxFor(admin.id, hhl.company.id);
    const firstEngine = months[0].start;
    const rows: Record<string, string>[] = [];
    let m = `${year}-01-01`;
    while (m < firstEngine) {
      const end = endOfMonth(m);
      for (const e of hhl.byCode.values()) {
        if (e.hireDate > end || e.status === "onboarding") continue;
        const rate = effectiveOn(await repo.payRates.list(hhl.company.id, { where: { employeeId: e.id } }), end)!;
        const monthly = rate.payType === "hourly" ? rate.amount * 8 * 21.7 : rate.basis === "annual" ? rate.amount / 12 : rate.amount;
        const gross = Math.round(monthly * 100) / 100;
        const ss = Math.round(Math.min(gross, 4000) * 0.045 * 100) / 100;
        const nhi = Math.round(gross * 0.0375 * 100) / 100;
        const pt = Math.round(Math.max(0, gross - 833.33) * 0.08 * 100) / 100;
        rows.push({ "Employee ID": e.employeeCode, "Period start": m, "Period end": end, "Pay date": addDays(end, -1), "Gross pay": gross.toFixed(2), "SS employee": ss.toFixed(2), "SS employer": ss.toFixed(2), "NHI employee": nhi.toFixed(2), "NHI employer": nhi.toFixed(2), "PT employee": pt.toFixed(2), "PT employer": (Math.round(gross * 0.06 * 100) / 100).toFixed(2), "Other deductions": "0", "Net pay": (gross - ss - nhi - pt).toFixed(2) });
      }
      m = addMonths(m, 1);
    }
    if (rows.length) {
      const mapping = { "Employee ID": "employeeCode", "Period start": "periodStart", "Period end": "periodEnd", "Pay date": "payDate", "Gross pay": "gross", "SS employee": "ssEmployee", "SS employer": "ssEmployer", "NHI employee": "nhiEmployee", "NHI employer": "nhiEmployer", "PT employee": "ptEmployee", "PT employer": "ptEmployer", "Other deductions": "otherDeductions", "Net pay": "net" };
      await call(actx, "imports.commit", { entity: "historical_payroll", fileName: "legacy-payroll-2026-h1.xlsx", rows, mapping, dateOrder: "YMD" });
    }
  }

  // A few HR events in the audit log at realistic times
  setClock(addDays(today, -2), 14);
  const hctx = await ctxFor((await repo.users.getByEmail("demo.hr@example.com"))!.id, hhl.company.id);
  await call(hctx, "employees.addNote", { employeeId: H("HHL-010").id, body: "Confirmed as Head Chef after a successful 3-month acting period." });
  setClock(today, 8);

  return { state: repo.snapshot(), blobs };
}
