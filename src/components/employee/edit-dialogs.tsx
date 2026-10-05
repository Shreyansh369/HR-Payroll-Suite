"use client";

import { useState } from "react";
import { useM, useQ } from "@/client/api";
import { useSession } from "@/client/session";
import type { Employee, EmploymentType, PayMethod } from "@/domain/types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/panel";
import { useToast } from "@/components/ui/toast";
import { fieldErrors } from "@/components/app/form-helpers";
import { EMPLOYMENT_TYPE_LABELS, PAY_METHOD_LABELS } from "@/lib/labels";

export function EditProfileDialog({ employee, open, onOpenChange, canSensitive }: { employee: Employee; open: boolean; onOpenChange: (o: boolean) => void; canSensitive: boolean }) {
  const toast = useToast();
  const { can } = useSession();
  const policies = useQ("leave.policies.list", {}, { enabled: open });
  const [f, setF] = useState(() => ({
    firstName: employee.firstName,
    lastName: employee.lastName,
    preferredName: employee.preferredName ?? "",
    dateOfBirth: employee.dateOfBirth,
    email: employee.email,
    phone: employee.phone,
    address: { line1: employee.address.line1, line2: employee.address.line2 ?? "", city: employee.address.city, region: employee.address.region ?? "", postalCode: employee.address.postalCode ?? "", country: employee.address.country },
    emergencyContact: { ...employee.emergencyContact },
    statutoryIds: { ...employee.statutoryIds },
    probationEndDate: employee.probationEndDate ?? "",
    workLocation: employee.workLocation,
    leavePolicyId: employee.leavePolicyId ?? "",
    payProfile: { ...employee.payProfile },
    status: employee.status,
  }));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const update = useM("employees.update", {
    onSuccess: () => {
      toast.success("Employee updated");
      onOpenChange(false);
    },
    onError: (e) => toast.error("Not saved", e.message),
  });
  const errs = fieldErrors(update.error);
  const canBank = can("salary.edit");
  const editableStatus = ["onboarding", "active", "on_leave"].includes(employee.status);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit employee"
      description="Department, position and manager changes are recorded from Employment history so the timeline stays accurate."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={update.isPending}
            onClick={() =>
              update.mutate({
                id: employee.id,
                firstName: f.firstName,
                lastName: f.lastName,
                preferredName: f.preferredName,
                dateOfBirth: f.dateOfBirth,
                email: f.email,
                phone: f.phone,
                address: f.address,
                emergencyContact: f.emergencyContact,
                statutoryIds: f.statutoryIds,
                probationEndDate: f.probationEndDate || null,
                workLocation: f.workLocation,
                leavePolicyId: f.leavePolicyId || null,
                payProfile: canBank ? f.payProfile : undefined,
                status: editableStatus ? (f.status as "active" | "onboarding" | "on_leave") : undefined,
              })
            }
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {update.error && !Object.keys(errs).length && <Callout tone="danger">{update.error.message}</Callout>}
        <FormGrid cols={3}>
          <Field label="First name" required error={errs.firstName}>
            <Input value={f.firstName} onChange={(e) => set("firstName", e.target.value)} />
          </Field>
          <Field label="Last name" required error={errs.lastName}>
            <Input value={f.lastName} onChange={(e) => set("lastName", e.target.value)} />
          </Field>
          <Field label="Preferred name">
            <Input value={f.preferredName} onChange={(e) => set("preferredName", e.target.value)} />
          </Field>
          <Field label="Date of birth" error={errs.dateOfBirth}>
            <Input type="date" value={f.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} />
          </Field>
          <Field label="Email" error={errs.email}>
            <Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={f.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Address" className="sm:col-span-2">
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
            <Input value={f.emergencyContact.phone} onChange={(e) => set("emergencyContact", { ...f.emergencyContact, phone: e.target.value })} />
          </Field>
          <Field label="Probation ends">
            <Input type="date" value={f.probationEndDate} onChange={(e) => set("probationEndDate", e.target.value)} />
          </Field>
          <Field label="Work location">
            <Input value={f.workLocation} onChange={(e) => set("workLocation", e.target.value)} />
          </Field>
          <Field label="Leave policy">
            <Select value={f.leavePolicyId} onChange={(e) => set("leavePolicyId", e.target.value)}>
              <option value="">No policy</option>
              {policies.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          {editableStatus && (
            <Field label="Status">
              <Select value={f.status} onChange={(e) => set("status", e.target.value as Employee["status"])}>
                <option value="onboarding">Onboarding</option>
                <option value="active">Active</option>
                <option value="on_leave">On leave (extended)</option>
              </Select>
            </Field>
          )}
        </FormGrid>
        {canSensitive && (
          <div>
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-3">Statutory identifiers</p>
            <FormGrid cols={3}>
              <Field label="Social Security number">
                <Input value={f.statutoryIds.socialSecurityNumber} onChange={(e) => set("statutoryIds", { ...f.statutoryIds, socialSecurityNumber: e.target.value })} />
              </Field>
              <Field label="NHI number">
                <Input value={f.statutoryIds.nhiNumber} onChange={(e) => set("statutoryIds", { ...f.statutoryIds, nhiNumber: e.target.value })} />
              </Field>
              <Field label="Tax ID">
                <Input value={f.statutoryIds.taxId} onChange={(e) => set("statutoryIds", { ...f.statutoryIds, taxId: e.target.value })} />
              </Field>
            </FormGrid>
          </div>
        )}
        {canBank && (
          <div>
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-3">Pay profile</p>
            <FormGrid cols={3}>
              <Field label="Pay method">
                <Select value={f.payProfile.payMethod} onChange={(e) => set("payProfile", { ...f.payProfile, payMethod: e.target.value as PayMethod })}>
                  {Object.entries(PAY_METHOD_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Bank">
                <Input value={f.payProfile.bankName} onChange={(e) => set("payProfile", { ...f.payProfile, bankName: e.target.value })} />
              </Field>
              <Field label="Account number">
                <Input value={f.payProfile.bankAccount} onChange={(e) => set("payProfile", { ...f.payProfile, bankAccount: e.target.value })} />
              </Field>
            </FormGrid>
          </div>
        )}
      </div>
    </Dialog>
  );
}

type EventType = "promotion" | "transfer" | "department_change" | "manager_change" | "employment_type_change" | "position_change" | "rehire";

export function RecordEventDialog({ employee, open, onOpenChange }: { employee: Employee; open: boolean; onOpenChange: (o: boolean) => void }) {
  const toast = useToast();
  const { ctx } = useSession();
  const deps = useQ("departments.list", {}, { enabled: open });
  const people = useQ("employees.options", { includeInactive: false }, { enabled: open });
  const leaver = employee.status === "terminated" || employee.status === "archived";
  const [type, setType] = useState<EventType>(leaver ? "rehire" : "promotion");
  const [effectiveDate, setDate] = useState(ctx.today);
  const [position, setPosition] = useState(employee.position);
  const [departmentId, setDept] = useState(employee.departmentId ?? "");
  const [managerId, setManager] = useState(employee.managerId ?? "");
  const [employmentType, setEmpType] = useState<EmploymentType>(employee.employmentType);
  const [note, setNote] = useState("");
  const record = useM("employees.recordEvent", {
    onSuccess: () => {
      toast.success("Change recorded", effectiveDate > ctx.today ? "It takes effect on the effective date." : undefined);
      onOpenChange(false);
    },
    onError: (e) => toast.error("Not saved", e.message),
  });
  const show = {
    position: ["promotion", "transfer", "position_change", "rehire"].includes(type),
    department: ["promotion", "transfer", "department_change", "rehire"].includes(type),
    manager: ["promotion", "transfer", "manager_change", "department_change", "rehire"].includes(type),
    employmentType: ["employment_type_change", "rehire"].includes(type),
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record employment change"
      description="Creates an effective-dated entry in the employment history. Pay changes are recorded from Compensation."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={record.isPending}
            onClick={() =>
              record.mutate({
                employeeId: employee.id,
                type,
                effectiveDate,
                position: show.position ? position : undefined,
                departmentId: show.department ? departmentId || null : undefined,
                managerId: show.manager ? managerId || null : undefined,
                employmentType: show.employmentType ? employmentType : undefined,
                note,
              })
            }
          >
            Record change
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {record.error && <Callout tone="danger">{record.error.message}</Callout>}
        <FormGrid cols={2}>
          <Field label="Change">
            <Select value={type} onChange={(e) => setType(e.target.value as EventType)}>
              {leaver ? (
                <option value="rehire">Rehire</option>
              ) : (
                <>
                  <option value="promotion">Promotion</option>
                  <option value="transfer">Transfer</option>
                  <option value="position_change">Position change</option>
                  <option value="department_change">Department change</option>
                  <option value="manager_change">Manager change</option>
                  <option value="employment_type_change">Employment type change</option>
                </>
              )}
            </Select>
          </Field>
          <Field label="Effective date">
            <Input type="date" value={effectiveDate} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {show.position && (
            <Field label="Position" className="sm:col-span-2">
              <Input value={position} onChange={(e) => setPosition(e.target.value)} />
            </Field>
          )}
          {show.department && (
            <Field label="Department">
              <Select value={departmentId} onChange={(e) => setDept(e.target.value)}>
                <option value="">No department</option>
                {deps.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {show.manager && (
            <Field label="Manager">
              <Select value={managerId} onChange={(e) => setManager(e.target.value)}>
                <option value="">No manager</option>
                {people.data?.filter((p) => p.id !== employee.id).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {show.employmentType && (
            <Field label="Employment type">
              <Select value={employmentType} onChange={(e) => setEmpType(e.target.value as EmploymentType)}>
                {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </FormGrid>
        <Field label="Note">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Reason or context" />
        </Field>
      </div>
    </Dialog>
  );
}

export function OffboardDialog({ employee, open, onOpenChange }: { employee: Employee; open: boolean; onOpenChange: (o: boolean) => void }) {
  const toast = useToast();
  const { ctx } = useSession();
  const [terminationDate, setDate] = useState(ctx.today);
  const [reason, setReason] = useState("");
  const start = useM("workflows.startOffboarding", {
    onSuccess: () => {
      toast.success("Offboarding started", "A checklist was created and the last day is recorded for final payroll.");
      onOpenChange(false);
    },
    onError: (e) => toast.error("Could not start offboarding", e.message),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Start offboarding"
      description="Sets the last working day (final pay is prorated), records a termination event and creates the exit checklist."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="danger" loading={start.isPending} disabled={!reason.trim()} onClick={() => start.mutate({ employeeId: employee.id, terminationDate, reason })}>
            Start offboarding
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="Last working day" required>
          <Input type="date" value={terminationDate} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Reason" required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. Resigned — relocating" />
        </Field>
      </div>
    </Dialog>
  );
}
