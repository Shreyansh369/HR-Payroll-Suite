"use client";

import { useState } from "react";
import { useM, useQ } from "@/client/api";
import { useSession } from "@/client/session";
import { PageHeader, Panel, EmptyState, LoadingRows, ErrorState } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Segmented, Field, Select, Input } from "@/components/ui/form";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { WorkflowCard } from "@/components/hr/workflows";

function StartOnboarding({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { ctx } = useSession();
  const people = useQ("employees.options", { includeInactive: false });
  const [employeeId, setEmp] = useState("");
  const [startDate, setStart] = useState(ctx.today);
  const start = useM("workflows.startOnboarding", { onSuccess: () => { toast.success("Onboarding started"); onClose(); }, onError: (e) => toast.error("Not started", e.message) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Start onboarding" description="New hires get a checklist automatically. Use this for rehires or employees added without one." size="sm" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!employeeId} loading={start.isPending} onClick={() => start.mutate({ employeeId, startDate })}>Start</Button></>}>
      <div className="space-y-3.5">
        <Field label="Employee" required>
          <Select value={employeeId} onChange={(e) => setEmp(e.target.value)}>
            <option value="">Select…</option>
            {people.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Start date"><Input type="date" value={startDate} onChange={(e) => setStart(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

export default function OnboardingPage() {
  const [type, setType] = useState<"all" | "onboarding" | "offboarding">("all");
  const [status, setStatus] = useState<"in_progress" | "completed">("in_progress");
  const [starting, setStarting] = useState(false);
  const q = useQ("workflows.list", { type: type === "all" ? undefined : type, status });
  return (
    <>
      <PageHeader
        title="Onboarding & offboarding"
        description="Checklists for new starters and leavers. Offboarding records the last day for final payroll and removes system access on completion. Start offboarding from an employee's profile."
        actions={<Button variant="primary" icon="add" onClick={() => setStarting(true)}>Start onboarding</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Segmented label="Type" value={type} onChange={setType} options={[{ value: "all", label: "All" }, { value: "onboarding", label: "Onboarding" }, { value: "offboarding", label: "Offboarding" }]} />
        <Segmented label="Status" value={status} onChange={setStatus} options={[{ value: "in_progress", label: "In progress" }, { value: "completed", label: "Completed" }]} />
      </div>
      {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState message={q.error.message} /> : q.data!.length === 0 ? (
        <Panel><EmptyState icon="checklist" title={status === "in_progress" ? "No checklists in progress" : "No completed checklists"} description="Adding an employee starts onboarding automatically." /></Panel>
      ) : (
        <div className="space-y-4">{q.data!.map((w) => <WorkflowCard key={w.id} workflow={w} showEmployee />)}</div>
      )}
      {starting && <StartOnboarding onClose={() => setStarting(false)} />}
    </>
  );
}
