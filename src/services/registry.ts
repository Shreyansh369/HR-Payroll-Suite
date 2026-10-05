/**
 * The complete procedure catalogue. Both transports dispatch into this object.
 */
import type { z } from "zod";
import { companyProcedures } from "@/services/procedures/company";
import { employeeProcedures } from "@/services/procedures/employees";
import { compensationProcedures } from "@/services/procedures/compensation";
import { leaveProcedures } from "@/services/procedures/leave";
import { attendanceProcedures } from "@/services/procedures/attendance";
import { documentProcedures } from "@/services/procedures/documents";
import { workflowProcedures } from "@/services/procedures/workflows";
import { payrollProcedures } from "@/services/procedures/payroll";
import { statutoryProcedures } from "@/services/procedures/statutory";
import { selfServiceProcedures } from "@/services/procedures/self-service";
import { adminProcedures } from "@/services/procedures/admin";
import { dashboardProcedures } from "@/services/procedures/dashboard";
import { reportProcedures } from "@/services/procedures/reports";
import { importProcedures } from "@/services/procedures/imports";
import type { Procedure } from "@/services/core";

export const procedures = {
  ...companyProcedures,
  ...employeeProcedures,
  ...compensationProcedures,
  ...leaveProcedures,
  ...attendanceProcedures,
  ...documentProcedures,
  ...workflowProcedures,
  ...payrollProcedures,
  ...statutoryProcedures,
  ...selfServiceProcedures,
  ...adminProcedures,
  ...dashboardProcedures,
  ...reportProcedures,
  ...importProcedures,
};

export type Procedures = typeof procedures;
export type ProcedureName = keyof Procedures;
export type ProcInput<N extends ProcedureName> = Procedures[N] extends Procedure<infer I, unknown> ? z.input<I> : never;
export type ProcOutput<N extends ProcedureName> = Procedures[N] extends Procedure<z.ZodType, infer O> ? O : never;

export function getProcedure(name: string): Procedure | null {
  return Object.prototype.hasOwnProperty.call(procedures, name) ? (procedures[name as ProcedureName] as unknown as Procedure) : null;
}
