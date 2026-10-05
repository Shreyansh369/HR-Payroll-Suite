import type { EmploymentType, PayMethod, PayFrequency, RateBasis, EmploymentEventType } from "@/domain/types";

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  temporary: "Temporary",
};

export const PAY_METHOD_LABELS: Record<PayMethod, string> = {
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  cash: "Cash",
};

export const FREQUENCY_SHORT: Record<PayFrequency, string> = {
  weekly: "weekly",
  biweekly: "biweekly",
  semi_monthly: "semi-monthly",
  monthly: "monthly",
};

export const BASIS_SUFFIX: Record<RateBasis, string> = {
  annual: "/ year",
  monthly: "/ month",
  semi_monthly: "/ half-month",
  biweekly: "/ 2 weeks",
  weekly: "/ week",
  daily: "/ day",
  hourly: "/ hour",
};

export const EVENT_LABELS: Record<EmploymentEventType | "schedule_change" | "salary_change", string> = {
  hire: "Hired",
  promotion: "Promotion",
  transfer: "Transfer",
  department_change: "Department change",
  manager_change: "Manager change",
  employment_type_change: "Employment type change",
  position_change: "Position change",
  termination: "Termination",
  rehire: "Rehired",
  schedule_change: "Schedule",
  salary_change: "Pay rate",
};

export const WEEKDAYS = [
  { value: 1, short: "Mon" },
  { value: 2, short: "Tue" },
  { value: 3, short: "Wed" },
  { value: 4, short: "Thu" },
  { value: 5, short: "Fri" },
  { value: 6, short: "Sat" },
  { value: 0, short: "Sun" },
];
