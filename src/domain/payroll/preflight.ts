/**
 * Pre-flight checks run before a payroll can be approved.
 * ERROR blocks approval; WARNING must be acknowledged; INFO is informational.
 */
import { formatMoney, formatNumber } from "@/lib/money";
import type { ISODate } from "@/lib/dates";
import type { Employee, PayrollEmployeeResult, PayrollRun, PreflightIssue, TimesheetEntry, LeaveRequest } from "@/domain/types";

export interface PreflightInput {
  run: Pick<PayrollRun, "id" | "type" | "periodStart" | "periodEnd">;
  results: Pick<PayrollEmployeeResult, "employeeId" | "employee" | "totals" | "warnings">[];
  employees: Pick<Employee, "id" | "firstName" | "lastName" | "dateOfBirth" | "address" | "email" | "terminationDate">[];
  previousResults: Pick<PayrollEmployeeResult, "employeeId" | "totals">[];
  timesheets: Pick<TimesheetEntry, "employeeId" | "date" | "absent" | "status">[];
  approvedLeave: Pick<LeaveRequest, "employeeId" | "startDate" | "endDate">[];
  varianceThreshold: number;
  currency: string;
  /** In production, unapproved statutory rules block approval. */
  requireApprovedRules: boolean;
  /** Statutory rule codes that exist only as drafts (no usable rule in force for the period). */
  draftOnlyRules?: { code: string; name: string }[];
}

export const SEVERITY_ORDER: Record<PreflightIssue["severity"], number> = { error: 0, warning: 1, info: 2 };

export function runPreflight(input: PreflightInput): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const add = (issue: PreflightIssue) => {
    if (!issues.some((i) => i.id === issue.id)) issues.push(issue);
  };
  const byEmp = new Map(input.employees.map((e) => [e.id, e]));
  const prev = new Map(input.previousResults.map((r) => [r.employeeId, r]));

  if (input.results.length === 0) {
    add({ id: "NO_EMPLOYEES:run", severity: "error", code: "NO_EMPLOYEES", message: "The payroll has no employees." });
  }
  for (const r of input.draftOnlyRules ?? []) {
    add({
      id: `RULE_DRAFT_ONLY_${r.code}:run`,
      severity: input.requireApprovedRules ? "error" : "warning",
      code: `RULE_DRAFT_ONLY_${r.code}`,
      employeeId: null,
      message: `${r.name} is not being calculated: its rule for this period is still a draft. Verify the rates and approve the rule.`,
    });
  }

  for (const r of input.results) {
    for (const w of r.warnings) {
      if (w.code.startsWith("RULE_NOT_APPROVED")) {
        // One run-level issue per rule rather than one per employee.
        add({
          ...w,
          id: `${w.code}:run`,
          employeeId: null,
          severity: input.requireApprovedRules ? "error" : "warning",
          message: input.requireApprovedRules ? `${w.message} Approve the rule before finalizing in production.` : w.message,
        });
      } else {
        add(w);
      }
    }
    const e = byEmp.get(r.employeeId);
    if (e && input.run.type !== "correction" && input.run.type !== "off_cycle") {
      const missing: string[] = [];
      if (!e.dateOfBirth) missing.push("date of birth");
      if (!e.address?.line1) missing.push("address");
      if (!e.email) missing.push("email");
      if (missing.length) {
        add({
          id: `MISSING_INFO:${e.id}`,
          severity: "warning",
          code: "MISSING_INFO",
          employeeId: e.id,
          message: `Missing employee information: ${missing.join(", ")}.`,
        });
      }
    }
    const p = prev.get(r.employeeId);
    if (p && p.totals.net > 0 && input.run.type === "regular") {
      const change = (r.totals.net - p.totals.net) / p.totals.net;
      if (Math.abs(change) > input.varianceThreshold) {
        add({
          id: `VARIANCE:${r.employeeId}`,
          severity: "warning",
          code: "VARIANCE",
          employeeId: r.employeeId,
          message: `Net pay changed ${change > 0 ? "+" : ""}${formatNumber(change * 100, 1)}% vs previous period (${formatMoney(p.totals.net, input.currency)} → ${formatMoney(r.totals.net, input.currency)}).`,
        });
      }
    } else if (!p && input.run.type === "regular" && input.previousResults.length > 0) {
      add({
        id: `NEW_IN_PAYROLL:${r.employeeId}`,
        severity: "info",
        code: "NEW_IN_PAYROLL",
        employeeId: r.employeeId,
        message: "Not paid in the previous period.",
      });
    }
  }

  // Absences without approved leave
  const leaveCovers = (employeeId: string, date: ISODate) =>
    input.approvedLeave.some((l) => l.employeeId === employeeId && l.startDate <= date && l.endDate >= date);
  const absences = new Map<string, number>();
  for (const t of input.timesheets) {
    if (t.absent && !leaveCovers(t.employeeId, t.date)) {
      absences.set(t.employeeId, (absences.get(t.employeeId) ?? 0) + 1);
    }
  }
  for (const [employeeId, count] of absences) {
    if (!input.results.some((r) => r.employeeId === employeeId)) continue;
    add({
      id: `ABSENCE_WITHOUT_LEAVE:${employeeId}`,
      severity: "warning",
      code: "ABSENCE_WITHOUT_LEAVE",
      employeeId,
      message: `${count} absence day(s) recorded without approved leave. Record unpaid leave if a deduction applies.`,
    });
  }

  return issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id));
}

export function preflightSummary(issues: PreflightIssue[], acknowledged: string[]) {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const unacknowledged = warnings.filter((w) => !acknowledged.includes(w.id));
  return {
    errors: errors.length,
    warnings: warnings.length,
    info: issues.filter((i) => i.severity === "info").length,
    unacknowledged: unacknowledged.length,
    canApprove: errors.length === 0 && unacknowledged.length === 0,
  };
}
