import { describe, expect, it } from "vitest";
import { as, seededRepo } from "./helpers";

describe("demo seed", () => {
  it("creates three companies, ~44 employees and payroll history", async () => {
    const { repo } = await seededRepo();
    const orgs = await repo.organizations.list();
    expect(orgs).toHaveLength(1);
    const companies = await repo.companies.listByOrganization(orgs[0].id);
    expect(companies.map((c) => c.branding.shortName).sort()).toEqual(["CPA", "HHL", "TMS"]);
    let employees = 0;
    let locked = 0;
    let review = 0;
    let corrections = 0;
    for (const c of companies) {
      employees += await repo.employees.count(c.id);
      locked += await repo.payrollRuns.count(c.id, { where: { status: "locked" } });
      review += await repo.payrollRuns.count(c.id, { where: { status: "review" } });
      corrections += await repo.payrollRuns.count(c.id, { where: { type: "correction" } });
    }
    expect(employees).toBe(44);
    expect(locked).toBeGreaterThanOrEqual(3);
    expect(review).toBe(1);
    expect(corrections).toBe(1);
  });
});

describe("authorization", () => {
  it("hides salary from supervisors and limits them to their team", async () => {
    const { repo, storage } = await seededRepo();
    const sup = await as(repo, storage, "demo.supervisor@example.com");
    const list = await sup.call("employees.list", { pageSize: 100 });
    expect(list.total).toBe(6); // self + 5 reports
    const outside = (await repo.employees.list(sup.company.id)).find((e) => e.employeeCode === "HHL-003")!;
    await expect(sup.call("employees.get", { id: outside.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const report = list.items.find((e) => e.employeeCode === "HHL-006")!;
    const detail = await sup.call("employees.get", { id: report.id });
    expect(detail.canSeeSalary).toBe(false);
    expect(detail.currentRate).toBeNull();
    expect(detail.employee.statutoryIds.socialSecurityNumber).toMatch(/^•+/);
    await expect(sup.call("compensation.get", { employeeId: report.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sup.call("payroll.runs.list", {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("restricts employees to their own records", async () => {
    const { repo, storage } = await seededRepo();
    const emp = await as(repo, storage, "demo.employee@example.com");
    await expect(emp.call("employees.list", {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    const payslips = await emp.call("me.payslips", {});
    expect(payslips.length).toBeGreaterThan(0);
    const other = (await repo.payrollResults.list(emp.company.id)).find((r) => r.employeeId !== emp.ctx.actor.employeeId)!;
    await expect(emp.call("me.payslip", { resultId: other.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const docs = await emp.call("documents.list", {});
    expect(docs.every((d) => d.visibility === "employee" && (d.employeeId === null || d.employeeId === emp.ctx.actor.employeeId))).toBe(true);
  });

  it("blocks cross-company access", async () => {
    const { repo, storage } = await seededRepo();
    const sup = await as(repo, storage, "demo.supervisor@example.com");
    const companies = await repo.companies.listByOrganization(sup.ctx.actor.organizationId);
    const tms = companies.find((c) => c.branding.shortName === "TMS")!;
    // Supervisor has no TMS membership: resolving falls back to their only company.
    const { resolveActor } = await import("@/services/authz");
    const actor = await resolveActor(repo, sup.ctx.actor.userId, tms.id);
    expect(actor.companyId).not.toBe(tms.id);
    const tmsEmployee = (await repo.employees.list(tms.id))[0];
    await expect(sup.call("employees.get", { id: tmsEmployee.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("prevents HR managers from viewing payroll", async () => {
    const { repo, storage } = await seededRepo();
    const hr = await as(repo, storage, "demo.hr@example.com");
    await expect(hr.call("payroll.runs.list", {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    const dash = await hr.call("dashboard.summary", {});
    expect(dash.payroll).toBeNull();
  });
});

describe("leave → payroll", () => {
  it("approved unpaid leave appears as a deduction in the next payroll", async () => {
    const { repo, storage } = await seededRepo();
    const payroll = await as(repo, storage, "demo.payroll@example.com");
    const suggestion = await payroll.call("payroll.runs.suggest", { frequency: "monthly" });
    expect(suggestion.start).toBe("2026-10-01");
    const run = await payroll.call("payroll.runs.create", { type: "regular", payFrequency: "monthly", periodStart: suggestion.start, periodEnd: suggestion.end, payDate: suggestion.payDate });
    await payroll.call("payroll.calculate", { runId: run.id });
    const detail = await payroll.call("payroll.runs.get", { id: run.id });
    const shanice = detail.results.find((r) => r.employee.code === "HHL-006")!;
    const unpaid = shanice.lines.find((l) => l.category === "unpaid_leave")!;
    expect(unpaid.quantity).toBe(2);
    expect(unpaid.amount).toBe(-184.62);
    expect(shanice.totals.gross).toBe(1815.38);
  });

  it("supervisor approves team leave; balance is reduced; employee cannot approve own", async () => {
    const { repo, storage } = await seededRepo();
    const sup = await as(repo, storage, "demo.supervisor@example.com");
    const pending = (await sup.call("leave.requests.list", { status: ["pending"] })).filter((r) => r.canDecide);
    expect(pending.length).toBeGreaterThanOrEqual(2);
    const target = pending.find((p) => p.paid && p.leaveTypeName === "Vacation")!;
    const before = (await sup.call("leave.balances", { employeeId: target.employeeId })).find((b) => b.leaveTypeId === target.leaveTypeId)!;
    await sup.call("leave.requests.decide", { id: target.id, decision: "approve", note: "" });
    const after = (await sup.call("leave.balances", { employeeId: target.employeeId })).find((b) => b.leaveTypeId === target.leaveTypeId)!;
    expect(after.scheduled).toBe(before.scheduled + target.quantity);
    expect(after.available).toBe(before.available - target.quantity);

    const emp = await as(repo, storage, "demo.employee@example.com");
    const types = await emp.call("leave.types.list", {});
    const vac = types.find((t) => t.code === "VAC")!;
    const created = await emp.call("leave.requests.create", { leaveTypeId: vac.id, startDate: "2026-11-16", endDate: "2026-11-17", reason: "Appointment" });
    expect(created.request.status).toBe("pending");
    await expect(emp.call("leave.requests.decide", { id: created.request.id, decision: "approve", note: "" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("payroll lifecycle", () => {
  it("calculate → review → approve → finalize → lock, then correction; locked runs stay locked", async () => {
    const { repo, storage } = await seededRepo();
    const payroll = await as(repo, storage, "demo.payroll@example.com", "TMS");
    const admin = await as(repo, storage, "demo.admin@example.com", "TMS");
    const runs = await payroll.call("payroll.runs.list", { status: ["review"] });
    const run = runs[0];
    await expect(admin.call("payroll.approve", { runId: run.id, note: "" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    const detail = await admin.call("payroll.runs.get", { id: run.id });
    const warnings = detail.run.preflight.issues.filter((i) => i.severity === "warning").map((i) => i.id);
    await admin.call("payroll.acknowledge", { runId: run.id, issueIds: warnings, acknowledged: true });
    await admin.call("payroll.approve", { runId: run.id, note: "ok" });
    await admin.call("payroll.finalize", { runId: run.id });
    await admin.call("payroll.lock", { runId: run.id });
    const locked = await admin.call("payroll.runs.get", { id: run.id });
    expect(locked.run.status).toBe("locked");
    const someEmployee = locked.run.employeeIds[0];
    await expect(payroll.call("payroll.inputs.save", { runId: run.id, input: { employeeId: someEmployee, kind: "earning", category: "bonus", label: "x", amount: 10 } })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(payroll.call("payroll.calculate", { runId: run.id })).rejects.toMatchObject({ code: "INVALID_STATE" });
    // Payroll officers cannot reopen
    await expect(payroll.call("payroll.reopen", { runId: run.id, reason: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const corr = await payroll.call("payroll.runs.create", { type: "correction", payFrequency: "semi_monthly", periodStart: run.periodStart, periodEnd: run.periodEnd, payDate: "2026-10-15", correctsRunId: run.id, correctionReason: "Missed allowance", employeeIds: [someEmployee] });
    await payroll.call("payroll.inputs.save", { runId: corr.id, input: { employeeId: someEmployee, kind: "earning", category: "adjustment", label: "Missed allowance", amount: 100 } });
    const calc = await payroll.call("payroll.calculate", { runId: corr.id });
    expect(calc.totals.gross).toBe(100);
    const audit = await admin.call("audit.list", { action: "payroll", pageSize: 200 });
    expect(audit.items.some((e) => e.action === "payroll.locked" && e.entityId === run.id)).toBe(true);
    expect(audit.items.some((e) => e.action === "payroll.correction_created")).toBe(true);
  });

  it("is deterministic: recalculating produces identical results", async () => {
    const { repo, storage } = await seededRepo();
    const payroll = await as(repo, storage, "demo.payroll@example.com", "TMS");
    const [run] = await payroll.call("payroll.runs.list", { status: ["review"] });
    const before = (await repo.payrollResults.list(payroll.company.id, { where: { runId: run.id } })).map((r) => ({ ...r, createdAt: "", updatedAt: "" }));
    await payroll.call("payroll.calculate", { runId: run.id });
    const after = (await repo.payrollResults.list(payroll.company.id, { where: { runId: run.id } })).map((r) => ({ ...r, createdAt: "", updatedAt: "" }));
    expect(after).toEqual(before);
  });
});

describe("reports, accounting and imports", () => {
  it("produces a balanced QuickBooks journal and reports", async () => {
    const { repo, storage } = await seededRepo();
    const acct = await as(repo, storage, "demo.accountant@example.com");
    const [run] = await acct.call("payroll.runs.list", { status: ["finalized"] });
    const journal = await acct.call("accounting.journal", { runId: run.id, mode: "summary" });
    expect(journal.balanced).toBe(true);
    const detailed = await acct.call("accounting.journal", { runId: run.id, mode: "detailed" });
    expect(detailed.balanced).toBe(true);
    for (const id of ["payroll_register", "gross_to_net"]) {
      const r = await acct.call("reports.run", { reportId: id, runId: run.id });
      expect(r.rows.length).toBe(run.totals!.employees);
    }
    for (const id of ["payroll_summary", "ytd", "corrections"]) expect((await acct.call("reports.run", { reportId: id, year: 2026 })).rows.length).toBeGreaterThan(0);
    for (const id of ["social_security", "nhi", "payroll_tax", "employer_cost", "earnings_history", "deduction_history"]) {
      expect((await acct.call("reports.run", { reportId: id, from: "2026-01-01", to: "2026-10-05" })).rows.length).toBeGreaterThan(0);
    }
    await expect(acct.call("reports.run", { reportId: "employee_master" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const hr = await as(repo, storage, "demo.hr@example.com");
    for (const id of ["headcount", "employee_master", "employment_history", "leave_report", "leave_balance"]) {
      expect((await hr.call("reports.run", { reportId: id, from: "2026-01-01", to: "2026-12-31" })).rows.length).toBeGreaterThan(0);
    }
  });

  it("imports employees with row-level errors and rejects duplicates", async () => {
    const { repo, storage } = await seededRepo();
    const admin = await as(repo, storage, "demo.admin@example.com");
    const rows = [
      { "Emp ID": "NEW-1", Name: "Ada Lovelace", DOB: "10/12/1990", Dept: "Finance", Title: "Analyst", "Start date": "01/09/2026", Salary: "$42,000", Basis: "annual", Frequency: "monthly" },
      { "Emp ID": "HHL-001", Name: "Dup Person", DOB: "1990-01-01", Dept: "Finance", Title: "X", "Start date": "2026-01-01" },
      { "Emp ID": "NEW-2", Name: "Bad Date", DOB: "31/31/1990", Dept: "Spa", Title: "Therapist", "Start date": "2026-01-01" },
    ];
    const mapping = { "Emp ID": "employeeCode", Name: "fullName", DOB: "dateOfBirth", Dept: "department", Title: "position", "Start date": "hireDate", Salary: "rateAmount", Basis: "rateBasis", Frequency: "payFrequency" };
    const v = await admin.call("imports.validate", { entity: "employees", rows, mapping, dateOrder: "DMY" });
    expect(v.summary).toEqual({ rows: 3, valid: 1, errors: 1, duplicates: 1 });
    expect(v.rows[1].errors[0]).toMatchObject({ row: 3, message: "Employee ID already exists" });
    const res = await admin.call("imports.commit", { entity: "employees", fileName: "people.csv", rows, mapping, dateOrder: "DMY" });
    expect(res.batch.totals).toMatchObject({ imported: 1, rejected: 1, duplicates: 1 });
    const imported = (await repo.employees.list(admin.company.id)).find((e) => e.employeeCode === "NEW-1")!;
    expect(imported.dateOfBirth).toBe("1990-12-10");
    expect(imported.hireDate).toBe("2026-09-01");
    expect((await repo.payRates.list(admin.company.id, { where: { employeeId: imported.id } }))[0].amount).toBe(42000);
  });
});

describe("documents", () => {
  it("rejects disguised executables and enforces download scope", async () => {
    const { repo, storage } = await seededRepo();
    const hr = await as(repo, storage, "demo.hr@example.com");
    const exe = btoa("MZ\u0090\u0000fake");
    await expect(hr.call("documents.upload", { employeeId: null, category: "other", title: "x", fileName: "x.pdf", mimeType: "application/pdf", contentBase64: exe, visibility: "hr" })).rejects.toMatchObject({ code: "VALIDATION" });
    const pdf = btoa("%PDF-1.4\n%test\n");
    const doc = await hr.call("documents.upload", { employeeId: null, category: "policy", title: "Policy", fileName: "p.pdf", mimeType: "application/pdf", contentBase64: pdf, visibility: "hr" });
    const dl = await hr.call("documents.download", { id: doc.id });
    expect(atob(dl.contentBase64)).toContain("%PDF");
    const emp = await as(repo, storage, "demo.employee@example.com");
    await expect(emp.call("documents.download", { id: doc.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
