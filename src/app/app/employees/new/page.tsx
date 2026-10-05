"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useM, useQ } from "@/client/api";
import { useSession } from "@/client/session";
import { PageHeader, Panel, Callout } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, FormGrid, FormSection, Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { fieldErrors, NumberInput, RateEquivalentsPreview, WorkDaysPicker } from "@/components/app/form-helpers";
import { EMPLOYMENT_TYPE_LABELS, PAY_METHOD_LABELS } from "@/lib/labels";
import { BASIS_LABELS, FREQUENCY_LABELS, DEFAULT_RATE_CONFIG } from "@/domain/payroll/rates";
import type { EmploymentType, PayFrequency, PayMethod, RateBasis } from "@/domain/types";

export default function NewEmployeePage() {
  const router = useRouter();
  const toast = useToast();
  const { ctx, can } = useSession();
  const deps = useQ("departments.list", {});
  const people = useQ("employees.options", { includeInactive: false });
  const policies = useQ("leave.policies.list", {});
  const company = useQ("company.get", {}, { enabled: can("company.view") || can("payroll.view") });
  const canSalary = can("salary.edit");

  const [f, setF] = useState({
    employeeCode: "",
    firstName: "",
    lastName: "",
    preferredName: "",
    dateOfBirth: "",
    email: "",
    phone: "",
    address: { line1: "", line2: "", city: "Road Town", region: "Tortola", postalCode: "", country: "British Virgin Islands" },
    emergencyContact: { name: "", relationship: "", phone: "" },
    statutoryIds: { socialSecurityNumber: "", nhiNumber: "", taxId: "" },
    employmentType: "full_time" as EmploymentType,
    hireDate: ctx.today,
    probationEndDate: "",
    departmentId: "",
    position: "",
    managerId: "",
    workLocation: "",
    leavePolicyId: "",
    payProfile: { payMethod: "bank_transfer" as PayMethod, bankName: "", bankAccount: "" },
    workDays: [1, 2, 3, 4, 5],
    hoursPerDay: 8 as number | null,
    includeRate: canSalary,
    payType: "salary" as "salary" | "hourly",
    amount: null as number | null,
    basis: "monthly" as RateBasis,
    payFrequency: "monthly" as PayFrequency,
    startOnboarding: true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const defaultPolicy = policies.data?.find((p) => p.isDefault)?.id ?? "";

  const create = useM("employees.create", {
    onSuccess: (r) => {
      toast.success(`${f.preferredName || f.firstName} ${f.lastName} added`, f.startOnboarding ? "An onboarding checklist was created." : undefined);
      router.push(`/app/employees/${r.id}`);
    },
    onError: (e) => toast.error("Employee not saved", e.message),
  });
  const errs = fieldErrors(create.error);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    create.mutate({
      employeeCode: f.employeeCode,
      firstName: f.firstName,
      lastName: f.lastName,
      preferredName: f.preferredName,
      dateOfBirth: f.dateOfBirth,
      email: f.email,
      phone: f.phone,
      address: f.address,
      emergencyContact: f.emergencyContact,
      statutoryIds: f.statutoryIds,
      employmentType: f.employmentType,
      hireDate: f.hireDate,
      probationEndDate: f.probationEndDate || null,
      departmentId: f.departmentId || null,
      position: f.position,
      managerId: f.managerId || null,
      workLocation: f.workLocation,
      leavePolicyId: (f.leavePolicyId || defaultPolicy) || null,
      payProfile: f.payProfile,
      schedule: { workDays: f.workDays, hoursPerDay: f.hoursPerDay ?? 0 },
      rate: f.includeRate && canSalary ? { payType: f.payType, amount: f.amount ?? 0, basis: f.basis, payFrequency: f.payFrequency } : null,
      startOnboarding: f.startOnboarding,
    });
  }

  const config = company.data?.payrollSettings ?? DEFAULT_RATE_CONFIG;

  return (
    <form onSubmit={submit} noValidate>
      <PageHeader
        title="Add employee"
        breadcrumbs={[{ label: "Employees", href: "/app/employees" }, { label: "New" }]}
        description="Required fields are marked. Pay and statutory details can be completed later."
        actions={
          <>
            <Button variant="ghost" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={create.isPending}>
              Save employee
            </Button>
          </>
        }
      />
      {create.error && !Object.keys(errs).length && <Callout tone="danger" className="mb-4">{create.error.message}</Callout>}
      <Panel padded className="space-y-6 p-5">
        <FormSection title="Identity" description="Legal name as it appears on identification and statutory filings.">
          <FormGrid cols={3}>
            <Field label="Employee ID" required error={errs.employeeCode} hint="Unique within this company">
              <Input value={f.employeeCode} onChange={(e) => set("employeeCode", e.target.value.toUpperCase())} placeholder="HHL-025" aria-invalid={!!errs.employeeCode} />
            </Field>
            <Field label="First name" required error={errs.firstName}>
              <Input value={f.firstName} onChange={(e) => set("firstName", e.target.value)} aria-invalid={!!errs.firstName} autoComplete="off" />
            </Field>
            <Field label="Last name" required error={errs.lastName}>
              <Input value={f.lastName} onChange={(e) => set("lastName", e.target.value)} aria-invalid={!!errs.lastName} autoComplete="off" />
            </Field>
            <Field label="Preferred name" hint="Shown in the directory">
              <Input value={f.preferredName} onChange={(e) => set("preferredName", e.target.value)} />
            </Field>
            <Field label="Date of birth" required error={errs.dateOfBirth}>
              <Input type="date" value={f.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} aria-invalid={!!errs.dateOfBirth} />
            </Field>
          </FormGrid>
        </FormSection>

        <FormSection title="Contact" description="Used for payslip delivery and emergencies.">
          <FormGrid cols={3}>
            <Field label="Email" error={errs.email}>
              <Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} aria-invalid={!!errs.email} />
            </Field>
            <Field label="Phone">
              <Input type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
            </Field>
            <div className="max-lg:hidden" />
            <Field label="Address" className="lg:col-span-2">
              <Input value={f.address.line1} onChange={(e) => set("address", { ...f.address, line1: e.target.value })} />
            </Field>
            <Field label="City / town">
              <Input value={f.address.city} onChange={(e) => set("address", { ...f.address, city: e.target.value })} />
            </Field>
            <Field label="Emergency contact">
              <Input value={f.emergencyContact.name} onChange={(e) => set("emergencyContact", { ...f.emergencyContact, name: e.target.value })} />
            </Field>
            <Field label="Relationship">
              <Input value={f.emergencyContact.relationship} onChange={(e) => set("emergencyContact", { ...f.emergencyContact, relationship: e.target.value })} />
            </Field>
            <Field label="Emergency phone">
              <Input type="tel" value={f.emergencyContact.phone} onChange={(e) => set("emergencyContact", { ...f.emergencyContact, phone: e.target.value })} />
            </Field>
          </FormGrid>
        </FormSection>

        <FormSection title="Employment">
          <FormGrid cols={3}>
            <Field label="Position" required error={errs.position}>
              <Input value={f.position} onChange={(e) => set("position", e.target.value)} aria-invalid={!!errs.position} />
            </Field>
            <Field label="Department">
              <Select value={f.departmentId} onChange={(e) => set("departmentId", e.target.value)}>
                <option value="">No department</option>
                {deps.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Manager">
              <Select value={f.managerId} onChange={(e) => set("managerId", e.target.value)}>
                <option value="">No manager</option>
                {people.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.position}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Employment type">
              <Select value={f.employmentType} onChange={(e) => set("employmentType", e.target.value as EmploymentType)}>
                {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Hire date" required error={errs.hireDate}>
              <Input type="date" value={f.hireDate} onChange={(e) => set("hireDate", e.target.value)} aria-invalid={!!errs.hireDate} />
            </Field>
            <Field label="Probation ends">
              <Input type="date" value={f.probationEndDate} onChange={(e) => set("probationEndDate", e.target.value)} />
            </Field>
            <Field label="Work location">
              <Input value={f.workLocation} onChange={(e) => set("workLocation", e.target.value)} placeholder="Road Town" />
            </Field>
            <Field label="Leave policy">
              <Select value={f.leavePolicyId || defaultPolicy} onChange={(e) => set("leavePolicyId", e.target.value)}>
                {policies.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </FormGrid>
          <div className="mt-4">
            <Checkbox label="Start an onboarding checklist" description="Creates tasks for HR, IT, payroll, the manager and the employee." checked={f.startOnboarding} onChange={(v) => set("startOnboarding", v)} />
          </div>
        </FormSection>

        <FormSection title="Work schedule" description="Drives proration, daily and hourly rates, and leave day counts.">
          <FormGrid cols={3}>
            <Field label="Working days" className="sm:col-span-2" error={errs["schedule.workDays"]}>
              <WorkDaysPicker value={f.workDays} onChange={(v) => set("workDays", v)} />
            </Field>
            <Field label="Hours per day" error={errs["schedule.hoursPerDay"]}>
              <NumberInput value={f.hoursPerDay} onChange={(v) => set("hoursPerDay", v)} step="0.25" min={0.5} max={24} />
            </Field>
          </FormGrid>
        </FormSection>

        {canSalary ? (
          <FormSection title="Pay" description="The starting rate is stored as the first effective-dated pay record.">
            <Checkbox label="Set a starting pay rate now" checked={f.includeRate} onChange={(v) => set("includeRate", v)} />
            {f.includeRate && (
              <div className="mt-3 space-y-3">
                <FormGrid cols={4}>
                  <Field label="Pay type">
                    <Select
                      value={f.payType}
                      onChange={(e) => {
                        const v = e.target.value as "salary" | "hourly";
                        setF((x) => ({ ...x, payType: v, basis: v === "hourly" ? "hourly" : x.basis === "hourly" ? "monthly" : x.basis }));
                      }}
                    >
                      <option value="salary">Salary</option>
                      <option value="hourly">Hourly</option>
                    </Select>
                  </Field>
                  <Field label="Amount" required error={errs["rate.amount"]}>
                    <NumberInput value={f.amount} onChange={(v) => set("amount", v)} step="0.01" min={0} prefix="$" aria-invalid={!!errs["rate.amount"]} />
                  </Field>
                  <Field label="Per">
                    <Select value={f.basis} onChange={(e) => set("basis", e.target.value as RateBasis)}>
                      {Object.entries(BASIS_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Pay frequency">
                    <Select value={f.payFrequency} onChange={(e) => set("payFrequency", e.target.value as PayFrequency)}>
                      {Object.entries(FREQUENCY_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </FormGrid>
                <RateEquivalentsPreview amount={f.amount ?? 0} basis={f.basis} workDays={f.workDays} hoursPerDay={f.hoursPerDay ?? 0} config={config} currency={ctx.company.currency} />
              </div>
            )}
            <FormGrid cols={3} className="mt-4">
              <Field label="Pay method">
                <Select value={f.payProfile.payMethod} onChange={(e) => set("payProfile", { ...f.payProfile, payMethod: e.target.value as PayMethod })}>
                  {Object.entries(PAY_METHOD_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Bank name">
                <Input value={f.payProfile.bankName} onChange={(e) => set("payProfile", { ...f.payProfile, bankName: e.target.value })} disabled={f.payProfile.payMethod !== "bank_transfer"} />
              </Field>
              <Field label="Account number">
                <Input value={f.payProfile.bankAccount} onChange={(e) => set("payProfile", { ...f.payProfile, bankAccount: e.target.value })} disabled={f.payProfile.payMethod !== "bank_transfer"} autoComplete="off" />
              </Field>
            </FormGrid>
          </FormSection>
        ) : (
          <FormSection title="Pay">
            <Callout tone="neutral">Your role cannot set salary or bank details. Payroll will complete the pay profile.</Callout>
          </FormSection>
        )}

        <FormSection title="Statutory identifiers" description="Stored encrypted in production and masked for roles without access.">
          <FormGrid cols={3}>
            <Field label="Social Security number">
              <Input value={f.statutoryIds.socialSecurityNumber} onChange={(e) => set("statutoryIds", { ...f.statutoryIds, socialSecurityNumber: e.target.value })} autoComplete="off" />
            </Field>
            <Field label="NHI number">
              <Input value={f.statutoryIds.nhiNumber} onChange={(e) => set("statutoryIds", { ...f.statutoryIds, nhiNumber: e.target.value })} autoComplete="off" />
            </Field>
            <Field label="Tax ID">
              <Input value={f.statutoryIds.taxId} onChange={(e) => set("statutoryIds", { ...f.statutoryIds, taxId: e.target.value })} autoComplete="off" />
            </Field>
          </FormGrid>
        </FormSection>
      </Panel>
      <div className="sticky bottom-0 z-10 -mx-3 mt-4 flex justify-end gap-2 border-t border-line bg-canvas/95 px-3 py-3 backdrop-blur-sm sm:hidden">
        <Button variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={create.isPending}>
          Save employee
        </Button>
      </div>
    </form>
  );
}
