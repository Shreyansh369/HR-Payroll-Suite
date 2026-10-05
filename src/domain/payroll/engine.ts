/**
 * Deterministic payroll calculation for one employee and one pay period.
 *
 * `calculateEmployeePayroll` is a pure function: given identical inputs it always
 * returns an identical result. It never reads the clock, storage or randomness.
 */
import { d, Decimal, money, round, sum, formatMoney, formatNumber, minD, maxD } from "@/lib/money";
import { daysInclusive, eachDay, maxDate, minDate, overlap, wholeYearsBetween, yearOf, type ISODate } from "@/lib/dates";
import { effectiveOn, holidaySet, isScheduledDay, sortEffective } from "@/domain/employee/schedule";
import { periodAmount, rateEquivalents, DAILY_METHOD_LABELS, type RateConfig } from "@/domain/payroll/rates";
import { applyStatutory, STATUTORY_SHORT_LABELS } from "@/domain/statutory/engine";
import type {
  Employee,
  Holiday,
  LeaveRequest,
  LeaveType,
  Loan,
  PayFrequency,
  PayItem,
  PayRate,
  PayrollEmployeeResult,
  PayrollInput,
  PayrollLine,
  PayrollRunType,
  PayrollSettings,
  PreflightIssue,
  StatutoryRule,
  TimesheetEntry,
  WorkSchedule,
} from "@/domain/types";

export const CALCULATION_VERSION = "2026.10.1";

export interface EmployeePayrollInput {
  employee: Pick<
    Employee,
    | "id"
    | "employeeCode"
    | "firstName"
    | "lastName"
    | "preferredName"
    | "dateOfBirth"
    | "hireDate"
    | "terminationDate"
    | "employmentType"
    | "position"
    | "statutoryIds"
    | "payProfile"
  >;
  departmentName: string;
  period: { start: ISODate; end: ISODate; payDate: ISODate; frequency: PayFrequency };
  runType: PayrollRunType;
  payRates: PayRate[];
  schedules: WorkSchedule[];
  payItems: PayItem[];
  inputs: PayrollInput[];
  timesheets: TimesheetEntry[];
  leaveRequests: LeaveRequest[];
  leaveTypes: LeaveType[];
  loans: { loan: Loan; outstanding: number }[];
  statutoryRules: StatutoryRule[];
  ytdContributable: Record<string, number>;
  headcount: number;
  holidays: Holiday[];
  settings: PayrollSettings;
  currency: string;
}

export type EmployeePayrollCalculation = Omit<
  PayrollEmployeeResult,
  "id" | "companyId" | "runId" | "createdAt" | "updatedAt"
>;

interface DayRate {
  rate: PayRate;
  schedule: WorkSchedule;
  daily: Decimal;
  hourly: Decimal;
}

function maskAccount(account: string): string {
  const digits = account.replace(/\s/g, "");
  if (digits.length <= 4) return digits ? `••${digits}` : "";
  return `••••${digits.slice(-4)}`;
}

export function displayName(e: { firstName: string; lastName: string; preferredName?: string }): string {
  return `${e.preferredName?.trim() || e.firstName} ${e.lastName}`;
}

export function calculateEmployeePayroll(input: EmployeePayrollInput): EmployeePayrollCalculation {
  const { employee, period, settings, currency } = input;
  const mode = settings.roundingMode;
  const fm = (x: Decimal | number) => formatMoney(money(x, mode), currency);
  const rateConfig: RateConfig = {
    weeksPerYear: settings.weeksPerYear,
    dailyRateMethod: settings.dailyRateMethod,
    fixedDaysPerMonth: settings.fixedDaysPerMonth,
  };
  const year = yearOf(period.end);
  const lines: PayrollLine[] = [];
  const warnings: PreflightIssue[] = [];
  const warn = (severity: PreflightIssue["severity"], code: string, message: string) =>
    warnings.push({ id: `${code}:${employee.id}`, severity, code, employeeId: employee.id, message });
  const addLine = (line: Omit<PayrollLine, "code"> & { code?: string }) => {
    lines.push({ ...line, code: line.code ?? `${line.section}.${line.category}.${lines.length + 1}` });
  };

  const rates = sortEffective(input.payRates);
  const schedules = sortEffective(input.schedules);
  const holidays = holidaySet(input.holidays);
  const periodDays = eachDay(period.start, period.end);

  // Employment window within the period
  const empStart = maxDate(period.start, employee.hireDate);
  const empEnd = employee.terminationDate ? minDate(period.end, employee.terminationDate) : period.end;
  const employed = empStart <= empEnd;
  const isEmployedOn = (day: ISODate) => employed && day >= empStart && day <= empEnd;

  if (employee.hireDate > period.start && employee.hireDate <= period.end) {
    warn("info", "STARTED_IN_PERIOD", `Started on ${employee.hireDate}; pay is prorated.`);
  }
  if (employee.terminationDate && employee.terminationDate >= period.start && employee.terminationDate <= period.end) {
    warn("warning", "TERMINATED_IN_PERIOD", `Employment ends on ${employee.terminationDate}; pay is prorated. Confirm final pay items.`);
  }

  // Per-day rate lookup
  const dayRate = new Map<ISODate, DayRate>();
  for (const day of periodDays) {
    const rate = effectiveOn(rates, day);
    const schedule = effectiveOn(schedules, day);
    if (!rate || !schedule) continue;
    const eq = rateEquivalents(
      rate.amount,
      rate.basis,
      { daysPerWeek: schedule.workDays.length, hoursPerDay: schedule.hoursPerDay },
      rateConfig,
      year,
    );
    dayRate.set(day, { rate, schedule, daily: eq.daily, hourly: eq.hourly });
  }

  const rateAtEnd = effectiveOn(rates, empEnd) ?? effectiveOn(rates, period.end);
  const scheduleAtEnd = effectiveOn(schedules, empEnd) ?? effectiveOn(schedules, period.end);
  const isCorrectionLike = input.runType === "correction" || input.runType === "off_cycle";

  if (!isCorrectionLike) {
    if (!rateAtEnd) warn("error", "MISSING_RATE", "No pay rate is in effect for this period.");
    if (!scheduleAtEnd) warn("error", "MISSING_SCHEDULE", "No work schedule is in effect for this period.");
  }
  const payType = rateAtEnd?.payType ?? "salary";

  // Rate segments (consecutive days with the same rate & schedule)
  type Segment = { from: ISODate; to: ISODate; rate: PayRate; schedule: WorkSchedule; daily: Decimal; hourly: Decimal };
  const segments: Segment[] = [];
  for (const day of periodDays) {
    const r = dayRate.get(day);
    if (!r) continue;
    const last = segments[segments.length - 1];
    if (last && last.rate.id === r.rate.id && last.schedule.id === r.schedule.id) last.to = day;
    else segments.push({ from: day, to: day, ...r });
  }
  if (segments.length > 1 && !isCorrectionLike) {
    warn("info", "RATE_CHANGE_IN_PERIOD", `Pay rate or schedule changes during the period (${segments.length} segments).`);
  }

  // Denominator for proration: scheduled days across the whole period. Days before the
  // first schedule starts (e.g. a mid-period hire) use the earliest schedule.
  const scheduleForDay = (day: ISODate) => effectiveOn(schedules, day) ?? schedules[0] ?? null;
  let scheduledDays = 0;
  let workedDays = 0;
  for (const day of periodDays) {
    const s = scheduleForDay(day);
    if (!s || !isScheduledDay(day, s.workDays)) continue;
    scheduledDays += 1;
    if (isEmployedOn(day)) workedDays += 1;
  }

  // ---------------------------------------------------------------- Regular pay
  let regular = d(0);
  if (!isCorrectionLike && employed) {
    if (payType === "salary") {
      const totalUnits =
        settings.prorationMethod === "calendar_days" ? periodDays.length : scheduledDays;
      for (const seg of segments) {
        if (seg.rate.payType !== "salary") continue;
        const segDays = eachDay(seg.from, seg.to);
        const units =
          settings.prorationMethod === "calendar_days"
            ? segDays.filter(isEmployedOn).length
            : segDays.filter((day) => isEmployedOn(day) && isScheduledDay(day, seg.schedule.workDays)).length;
        if (units === 0 || totalUnits === 0) continue;
        const full = periodAmount(
          seg.rate.amount,
          seg.rate.basis,
          period.frequency,
          { daysPerWeek: seg.schedule.workDays.length, hoursPerDay: seg.schedule.hoursPerDay },
          rateConfig,
          year,
        );
        const amount = units === totalUnits ? full : full.times(units).div(totalUnits);
        const unitLabel = settings.prorationMethod === "calendar_days" ? "calendar days" : "working days";
        const amt = money(amount, mode);
        regular = regular.plus(amt);
        addLine({
          section: "earning",
          category: "regular",
          label: segments.length > 1 ? `Regular salary (${seg.from} – ${seg.to})` : "Regular salary",
          quantity: units,
          unit: "days",
          rate: money(full, mode),
          amount: amt,
          taxable: true,
          formula:
            units === totalUnits
              ? `${fm(full)} per ${period.frequency.replace("_", "-")} period`
              : `${fm(full)} × ${units}/${totalUnits} ${unitLabel}`,
          source: "pay_rate",
          sourceRef: seg.rate.id,
        });
      }
    } else {
      // Hourly: approved timesheets are the source of hours
      const approved = input.timesheets.filter((t) => t.status === "approved" && isEmployedOn(t.date));
      const pending = input.timesheets.filter((t) => t.status === "submitted" && isEmployedOn(t.date));
      if (pending.length > 0) {
        warn("warning", "UNAPPROVED_TIMESHEETS", `${pending.length} timesheet day(s) awaiting approval are not paid.`);
      }
      const hoursByRate = new Map<string, { hours: Decimal; hourly: Decimal; rateId: string }>();
      if (approved.length > 0) {
        for (const t of approved) {
          const r = dayRate.get(t.date);
          if (!r) continue;
          const key = r.rate.id;
          const cur = hoursByRate.get(key) ?? { hours: d(0), hourly: r.hourly, rateId: r.rate.id };
          cur.hours = cur.hours.plus(t.workedHours);
          hoursByRate.set(key, cur);
        }
      } else if (settings.hourlyFallbackToSchedule) {
        warn("warning", "MISSING_TIMESHEET", "No approved timesheet; scheduled hours were paid.");
        for (const day of periodDays) {
          const r = dayRate.get(day);
          if (!r || !isEmployedOn(day) || !isScheduledDay(day, r.schedule.workDays) || holidays.has(day)) continue;
          const cur = hoursByRate.get(r.rate.id) ?? { hours: d(0), hourly: r.hourly, rateId: r.rate.id };
          cur.hours = cur.hours.plus(r.schedule.hoursPerDay);
          hoursByRate.set(r.rate.id, cur);
        }
      } else {
        warn("warning", "MISSING_TIMESHEET", "Hourly employee has no approved timesheet for this period.");
      }
      for (const { hours, hourly, rateId } of hoursByRate.values()) {
        const amt = money(hours.times(hourly), mode);
        regular = regular.plus(amt);
        addLine({
          section: "earning",
          category: "regular",
          label: "Regular hours",
          quantity: Number(hours.toFixed(2)),
          unit: "hours",
          rate: Number(hourly.toDecimalPlaces(4).toString()),
          amount: amt,
          taxable: true,
          formula: `${formatNumber(Number(hours))} h × ${fm(hourly)}`,
          source: approved.length > 0 ? "attendance" : "pay_rate",
          sourceRef: rateId,
        });
      }
    }
  }

  // ---------------------------------------------------------------- Overtime (attendance)
  if (!isCorrectionLike && employed) {
    const otApproved = input.timesheets.filter((t) => t.status === "approved" && t.overtimeHours > 0 && isEmployedOn(t.date));
    const otPending = input.timesheets.filter((t) => t.status !== "approved" && t.overtimeHours > 0 && isEmployedOn(t.date));
    if (otPending.length > 0) {
      const hrs = sum(otPending.map((t) => t.overtimeHours));
      warn("warning", "UNAPPROVED_OVERTIME", `${formatNumber(Number(hrs))} h of overtime is not approved and was not paid.`);
    }
    const byRate = new Map<string, { hours: Decimal; hourly: Decimal }>();
    for (const t of otApproved) {
      const r = dayRate.get(t.date);
      if (!r) continue;
      const cur = byRate.get(r.rate.id) ?? { hours: d(0), hourly: r.hourly };
      cur.hours = cur.hours.plus(t.overtimeHours);
      byRate.set(r.rate.id, cur);
    }
    for (const [rateId, { hours, hourly }] of byRate) {
      const otRate = hourly.times(settings.overtimeMultiplier);
      addLine({
        section: "earning",
        category: "overtime",
        label: "Overtime",
        quantity: Number(hours.toFixed(2)),
        unit: "hours",
        rate: Number(otRate.toDecimalPlaces(4).toString()),
        amount: money(hours.times(otRate), mode),
        taxable: true,
        formula: `${formatNumber(Number(hours))} h × ${fm(hourly)} × ${settings.overtimeMultiplier}`,
        source: "attendance",
        sourceRef: rateId,
      });
    }
  }

  // ---------------------------------------------------------------- Leave
  if (!isCorrectionLike && employed) {
    const typeById = new Map(input.leaveTypes.map((t) => [t.id, t]));
    const unpaidLines: { amount: Decimal; line: Omit<PayrollLine, "code"> }[] = [];
    for (const req of input.leaveRequests) {
      if (req.status !== "approved") continue;
      const type = typeById.get(req.leaveTypeId);
      if (!type) continue;
      const ov = overlap({ start: req.startDate, end: req.endDate }, { start: empStart, end: empEnd });
      if (!ov) continue;
      const days = eachDay(ov.start, ov.end).filter((day) => {
        const r = dayRate.get(day);
        return r && isScheduledDay(day, r.schedule.workDays) && !holidays.has(day);
      });
      if (days.length === 0) continue;
      const crosses = req.startDate < period.start || req.endDate > period.end;
      const crossNote = crosses ? ` (portion within period; request ${req.startDate} – ${req.endDate})` : "";

      if (type.paid) {
        addLine({
          section: "info",
          category: "paid_leave",
          label: `${type.name} (paid)`,
          quantity: req.hours && days.length === 1 ? req.hours : days.length,
          unit: req.hours && days.length === 1 ? "hours" : "days",
          amount: 0,
          taxable: false,
          formula: `${req.hours && days.length === 1 ? `${req.hours} h` : `${days.length} day(s)`} paid at the regular rate${crossNote}`,
          source: "leave",
          sourceRef: req.id,
        });
        continue;
      }

      if (payType === "hourly") {
        addLine({
          section: "info",
          category: "unpaid_leave",
          label: `${type.name}`,
          quantity: days.length,
          unit: "days",
          amount: 0,
          taxable: false,
          formula: `Hourly employee — hours not worked are not paid, no deduction required${crossNote}`,
          source: "leave",
          sourceRef: req.id,
        });
        continue;
      }

      let amount = d(0);
      let formula: string;
      let quantity: number;
      let unit: "days" | "hours";
      if (req.hours && days.length === 1) {
        const r = dayRate.get(days[0])!;
        amount = r.hourly.times(req.hours);
        quantity = req.hours;
        unit = "hours";
        formula = `${req.hours} h × ${fm(r.hourly)} hourly rate`;
      } else {
        const byDaily = new Map<string, { count: number; daily: Decimal }>();
        for (const day of days) {
          const r = dayRate.get(day)!;
          const key = r.daily.toString();
          const cur = byDaily.get(key) ?? { count: 0, daily: r.daily };
          cur.count += 1;
          byDaily.set(key, cur);
        }
        amount = sum([...byDaily.values()].map((v) => v.daily.times(v.count)));
        quantity = days.length;
        unit = "days";
        formula = [...byDaily.values()].map((v) => `${v.count} day(s) × ${fm(v.daily)} daily rate`).join(" + ");
      }
      unpaidLines.push({
        amount,
        line: {
          section: "earning",
          category: "unpaid_leave",
          label: type.name,
          quantity,
          unit,
          rate: null,
          amount: 0,
          taxable: true,
          formula: formula + crossNote,
          source: "leave",
          sourceRef: req.id,
        },
      });
    }
    // Cap total unpaid deduction at regular pay so pay never goes below zero from absence alone
    const totalUnpaid = sum(unpaidLines.map((u) => u.amount));
    const capped = totalUnpaid.gt(regular);
    let remainingCap = regular;
    for (const u of unpaidLines) {
      const amt = minD(u.amount, remainingCap);
      remainingCap = remainingCap.minus(amt);
      addLine({
        ...u.line,
        amount: -money(amt, mode),
        formula: capped ? `${u.line.formula} (limited to regular pay)` : u.line.formula,
      });
    }
    if (unpaidLines.length > 0) {
      warn("info", "UNPAID_LEAVE", `Unpaid leave deduction of ${fm(minD(totalUnpaid, regular))} applied.`);
    }
  }

  const regularNet = sum(lines.filter((l) => l.section === "earning" && (l.category === "regular" || l.category === "unpaid_leave")).map((l) => l.amount));

  // ---------------------------------------------------------------- Recurring items
  const recurring = isCorrectionLike
    ? []
    : input.payItems.filter(
        (i) => i.active && i.startDate <= period.end && (!i.endDate || i.endDate >= period.start) && employed,
      );
  for (const item of recurring.filter((i) => i.kind === "earning")) {
    const amount = item.method === "percent_of_base" ? regularNet.times(item.amount) : d(item.amount);
    addLine({
      section: "earning",
      category: item.category,
      label: item.label,
      amount: money(amount, mode),
      taxable: item.taxable,
      formula: item.method === "percent_of_base" ? `${formatNumber(item.amount * 100)}% × ${fm(regularNet)} base pay` : "Recurring fixed amount",
      source: "recurring",
      sourceRef: item.id,
    });
  }

  // ---------------------------------------------------------------- One-time inputs
  for (const inp of input.inputs.filter((i) => i.kind === "earning")) {
    let amount: Decimal;
    let formula: string;
    let quantity: number | null = null;
    let unit: PayrollLine["unit"] = null;
    if (inp.category === "overtime" && inp.hours) {
      const r = dayRate.get(empEnd) ?? dayRate.get(period.end);
      const hourly = r?.hourly ?? d(0);
      const otRate = hourly.times(settings.overtimeMultiplier);
      amount = otRate.times(inp.hours);
      quantity = inp.hours;
      unit = "hours";
      formula = `Adjustment: ${formatNumber(inp.hours)} h × ${fm(hourly)} × ${settings.overtimeMultiplier}`;
    } else {
      amount = d(inp.amount ?? 0);
      formula = inp.note ? `One-time: ${inp.note}` : "One-time amount";
    }
    addLine({
      section: "earning",
      category: inp.category,
      label: inp.label,
      quantity,
      unit,
      amount: money(amount, mode),
      taxable: inp.taxable,
      formula,
      source: input.runType === "correction" ? "correction" : "one_time",
      sourceRef: inp.id,
    });
  }

  const earnings = lines.filter((l) => l.section === "earning");
  const gross = sum(earnings.map((l) => l.amount));
  const taxableEarnings = sum(earnings.filter((l) => l.taxable).map((l) => l.amount));

  // ---------------------------------------------------------------- Deductions
  const deductionSources: { label: string; category: string; amount: Decimal; pretax: boolean; formula: string; source: PayrollLine["source"]; ref: string }[] = [];
  for (const item of recurring.filter((i) => i.kind === "deduction")) {
    const amount = item.method === "percent_of_base" ? regularNet.times(item.amount) : d(item.amount);
    deductionSources.push({
      label: item.label,
      category: item.category,
      amount,
      pretax: item.pretax,
      formula: item.method === "percent_of_base" ? `${formatNumber(item.amount * 100)}% × ${fm(regularNet)} base pay` : "Recurring fixed amount",
      source: "recurring",
      ref: item.id,
    });
  }
  for (const inp of input.inputs.filter((i) => i.kind === "deduction")) {
    deductionSources.push({
      label: inp.label,
      category: inp.category,
      amount: d(inp.amount ?? 0),
      pretax: inp.pretax,
      formula: inp.note ? `One-time: ${inp.note}` : "One-time deduction",
      source: input.runType === "correction" ? "correction" : "one_time",
      ref: inp.id,
    });
  }

  for (const ds of deductionSources.filter((x) => x.pretax)) {
    addLine({
      section: "pre_tax_deduction",
      category: ds.category,
      label: ds.label,
      amount: money(ds.amount, mode),
      taxable: false,
      formula: ds.formula,
      source: ds.source,
      sourceRef: ds.ref,
    });
  }
  const preTax = sum(lines.filter((l) => l.section === "pre_tax_deduction").map((l) => l.amount));
  const taxable = maxD(taxableEarnings.minus(preTax), 0);

  // ---------------------------------------------------------------- Statutory
  const basisDate = settings.statutoryDateBasis === "pay_date" ? period.payDate : period.end;
  const age = employee.dateOfBirth ? wholeYearsBetween(employee.dateOfBirth, period.end) : null;
  const statutory =
    input.runType === "historical"
      ? []
      : applyStatutory(input.statutoryRules, basisDate, {
          grossBase: money(maxD(taxableEarnings, 0)),
          taxableBase: money(taxable),
          frequency: period.frequency,
          weeksPerYear: settings.weeksPerYear,
          age,
          employmentType: employee.employmentType,
          headcount: input.headcount,
          ytdContributable: input.ytdContributable,
          currency,
        });
  if (statutory.length === 0 && input.runType !== "historical") {
    warn("warning", "NO_STATUTORY_RULES", `No statutory rules are in effect on ${basisDate}.`);
  }
  for (const s of statutory) {
    if (s.employeeAmount !== 0) {
      addLine({
        code: `statutory_employee.${s.code}`,
        section: "statutory_employee",
        category: s.type,
        label: `${STATUTORY_SHORT_LABELS[s.type]} (employee)`,
        rate: s.employeeRate,
        amount: s.employeeAmount,
        taxable: false,
        formula: s.explanation,
        source: "statutory",
        sourceRef: s.ruleId,
      });
    }
    if (s.employerAmount !== 0) {
      addLine({
        code: `statutory_employer.${s.code}`,
        section: "statutory_employer",
        category: s.type,
        label: `${STATUTORY_SHORT_LABELS[s.type]} (employer)`,
        rate: s.employerRate,
        amount: s.employerAmount,
        taxable: false,
        formula: s.explanation,
        source: "statutory",
        sourceRef: s.ruleId,
      });
    }
    if (s.ceilingApplied) warn("info", `CEILING_REACHED_${s.code}`, `${s.name}: contribution ceiling reached.`);
    if (s.status !== "approved") {
      warn("warning", `RULE_NOT_APPROVED_${s.code}`, `${s.name} uses a rule that has not been approved (${s.status}).`);
    }
  }
  const employeeStatutory = sum(lines.filter((l) => l.section === "statutory_employee").map((l) => l.amount));
  const employerStatutory = sum(lines.filter((l) => l.section === "statutory_employer").map((l) => l.amount));

  // Post-tax deductions and loans
  for (const ds of deductionSources.filter((x) => !x.pretax)) {
    addLine({
      section: "deduction",
      category: ds.category,
      label: ds.label,
      amount: money(ds.amount, mode),
      taxable: false,
      formula: ds.formula,
      source: ds.source,
      sourceRef: ds.ref,
    });
  }
  if (!isCorrectionLike && employed) {
    for (const { loan, outstanding } of input.loans) {
      if (loan.status !== "active" || loan.startDate > period.payDate || outstanding <= 0) continue;
      const amount = minD(loan.installment, outstanding);
      addLine({
        section: "deduction",
        category: loan.type,
        label: `${loan.type === "loan" ? "Loan" : "Salary advance"} repayment (${loan.reference})`,
        amount: money(amount, mode),
        taxable: false,
        formula: `Installment ${fm(loan.installment)}; balance before ${fm(outstanding)}, after ${fm(d(outstanding).minus(amount))}`,
        source: "loan",
        sourceRef: loan.id,
      });
    }
  }
  const postTax = sum(lines.filter((l) => l.section === "deduction").map((l) => l.amount));
  const net = gross.minus(preTax).minus(employeeStatutory).minus(postTax);

  // ---------------------------------------------------------------- Checks
  if (net.lt(0)) warn("error", "NEGATIVE_NET", `Net pay is negative (${fm(net)}).`);
  const voluntary = preTax.plus(postTax);
  if (gross.gt(0) && voluntary.div(gross).gt(settings.maxDeductionRatio)) {
    warn(
      "warning",
      "EXCESSIVE_DEDUCTIONS",
      `Deductions are ${formatNumber(Number(voluntary.div(gross).times(100)), 1)}% of gross pay (limit ${formatNumber(settings.maxDeductionRatio * 100, 0)}%).`,
    );
  }
  if (!isCorrectionLike && !employee.statutoryIds.socialSecurityNumber) {
    warn("warning", "MISSING_STATUTORY_ID", "Social Security number is missing.");
  }
  if (!isCorrectionLike && !employee.statutoryIds.nhiNumber) {
    warn("warning", "MISSING_NHI_ID", "NHI number is missing.");
  }
  if (!isCorrectionLike && employee.payProfile.payMethod === "bank_transfer" && !employee.payProfile.bankAccount) {
    warn("warning", "MISSING_BANK", "Bank transfer selected but no bank account is recorded.");
  }

  const rd = (x: Decimal) => money(round(x, mode));
  const segmentsOut = segments.map((s) => ({
    from: s.from,
    to: s.to,
    payType: s.rate.payType,
    amount: s.rate.amount,
    basis: s.rate.basis,
    periodAmount: money(
      periodAmount(s.rate.amount, s.rate.basis, period.frequency, { daysPerWeek: s.schedule.workDays.length, hoursPerDay: s.schedule.hoursPerDay }, rateConfig, year),
      mode,
    ),
    dailyRate: Number(s.daily.toDecimalPlaces(4).toString()),
    hourlyRate: Number(s.hourly.toDecimalPlaces(4).toString()),
  }));

  return {
    employeeId: employee.id,
    payDate: period.payDate,
    periodStart: period.start,
    periodEnd: period.end,
    runType: input.runType,
    employee: {
      code: employee.employeeCode,
      name: displayName(employee),
      departmentName: input.departmentName,
      position: employee.position,
      payType,
      employmentType: employee.employmentType,
      payMethod: employee.payProfile.payMethod,
      bankAccountMasked: maskAccount(employee.payProfile.bankAccount),
    },
    rates: {
      segments: segmentsOut,
      schedule: scheduleAtEnd
        ? { workDays: scheduleAtEnd.workDays, hoursPerDay: scheduleAtEnd.hoursPerDay }
        : { workDays: [], hoursPerDay: 0 },
      methodology: `${DAILY_METHOD_LABELS[settings.dailyRateMethod]}; ${settings.weeksPerYear} weeks/year; proration by ${settings.prorationMethod.replace("_", " ")}; overtime × ${settings.overtimeMultiplier}`,
    },
    lines,
    totals: {
      gross: rd(gross),
      preTaxDeductions: rd(preTax),
      taxable: rd(taxable),
      employeeStatutory: rd(employeeStatutory),
      employerStatutory: rd(employerStatutory),
      postTaxDeductions: rd(postTax),
      net: rd(net),
      employerCost: rd(gross.plus(employerStatutory)),
    },
    statutory,
    workedDays,
    scheduledDays,
    warnings,
    calculationVersion: CALCULATION_VERSION,
  };
}

/** Sum of employee results into run totals. */
export function sumTotals(results: Pick<PayrollEmployeeResult, "totals">[]) {
  const pick = (k: keyof PayrollEmployeeResult["totals"]) => money(sum(results.map((r) => r.totals[k])));
  return {
    employees: results.length,
    gross: pick("gross"),
    preTaxDeductions: pick("preTaxDeductions"),
    taxable: pick("taxable"),
    employeeStatutory: pick("employeeStatutory"),
    employerStatutory: pick("employerStatutory"),
    postTaxDeductions: pick("postTaxDeductions"),
    net: pick("net"),
    employerCost: pick("employerCost"),
  };
}

/** Aggregations used by the review table and reports. */
export function lineTotal(result: Pick<PayrollEmployeeResult, "lines">, predicate: (l: PayrollLine) => boolean): number {
  return money(sum(result.lines.filter(predicate).map((l) => l.amount)));
}

export function reviewColumns(result: Pick<PayrollEmployeeResult, "lines" | "totals">) {
  return {
    regular: lineTotal(result, (l) => l.section === "earning" && l.category === "regular"),
    overtime: lineTotal(result, (l) => l.section === "earning" && l.category === "overtime"),
    variable: lineTotal(
      result,
      (l) => l.section === "earning" && ["bonus", "commission", "allowance", "adjustment", "other"].includes(l.category),
    ),
    unpaidLeave: lineTotal(result, (l) => l.section === "earning" && l.category === "unpaid_leave"),
    deductions: money(d(result.totals.preTaxDeductions).plus(result.totals.postTaxDeductions)),
    statutory: result.totals.employeeStatutory,
    gross: result.totals.gross,
    net: result.totals.net,
  };
}

export function daysInPeriod(start: ISODate, end: ISODate): number {
  return daysInclusive(start, end);
}
