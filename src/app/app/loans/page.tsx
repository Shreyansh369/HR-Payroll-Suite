"use client";

import { useState } from "react";
import Link from "next/link";
import { useM, useQ } from "@/client/api";
import { useSession } from "@/client/session";
import type { ProcOutput } from "@/services/registry";
import { PageHeader, Panel, EmptyState, LoadingRows, ErrorState, Callout } from "@/components/ui/panel";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormGrid, Input, Segmented } from "@/components/ui/form";
import { DataTable, Money, TotalsRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { Menu, MenuItem } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { LoanDialog } from "@/components/employee/compensation";
import { ProgressBar } from "@/components/app/charts";
import { NumberInput } from "@/components/app/form-helpers";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

type Loan = ProcOutput<"loans.list">[number];

function RepaymentDialog({ loan, currency, onClose }: { loan: Loan; currency: string; onClose: () => void }) {
  const toast = useToast();
  const { ctx } = useSession();
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(ctx.today);
  const [note, setNote] = useState("");
  const pay = useM("loans.addRepayment", { onSuccess: () => { toast.success("Repayment recorded"); onClose(); }, onError: (e) => toast.error("Not recorded", e.message) });
  return (
    <Dialog open size="sm" onOpenChange={(o) => !o && onClose()} title={`Manual repayment · ${loan.reference}`} description={`Outstanding ${formatMoney(loan.outstanding, currency)}. For repayments made outside payroll (cash, transfer, final pay settlement).`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!amount || !note.trim()} loading={pay.isPending} onClick={() => pay.mutate({ id: loan.id, date, amount: amount ?? 0, note })}>Record repayment</Button></>}>
      <div className="space-y-3.5">
        {pay.error && <Callout tone="danger">{pay.error.message}</Callout>}
        <FormGrid cols={2}>
          <Field label="Amount" required><NumberInput value={amount} onChange={setAmount} step="0.01" prefix="$" /></Field>
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </FormGrid>
        <Field label="Note" required><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Cash repayment, receipt #1042" /></Field>
      </div>
    </Dialog>
  );
}

export default function LoansPage() {
  const { ctx, can } = useSession();
  const [status, setStatus] = useState<"active" | "paid" | "all">("active");
  const [issuing, setIssuing] = useState(false);
  const [repaying, setRepaying] = useState<Loan | null>(null);
  const q = useQ("loans.list", { status: status === "all" ? undefined : status });
  const cur = ctx.company.currency;
  const rows = q.data ?? [];
  return (
    <>
      <PageHeader
        title="Loans & advances"
        description="Installments are deducted automatically in each payroll until repaid. Balances update when a payroll is finalized."
        actions={can("salary.edit") && <Button variant="primary" icon="add" onClick={() => setIssuing(true)}>Issue loan or advance</Button>}
      />
      <Panel>
        <div className="flex items-center justify-between border-b border-line p-3">
          <Segmented label="Status" value={status} onChange={setStatus} options={[{ value: "active", label: "Active" }, { value: "paid", label: "Paid off" }, { value: "all", label: "All" }]} />
        </div>
        {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState message={q.error.message} /> : (
          <DataTable
            columns={[
              { key: "ref", header: "Reference", sortValue: (l) => l.reference, cell: (l) => <span className="font-mono text-[12px]">{l.reference}</span> },
              { key: "emp", header: "Employee", sortValue: (l) => l.employeeName, cell: (l) => <Link href={`/app/employees/${l.employeeId}`} className="font-medium hover:underline">{l.employeeName}</Link> },
              { key: "type", header: "Type", hideBelow: "md", cell: (l) => (l.type === "loan" ? "Loan" : "Salary advance") },
              { key: "issued", header: "Issued", hideBelow: "lg", cell: (l) => <span className="num text-ink-2">{formatDate(l.issuedDate)}</span> },
              { key: "principal", header: "Principal", align: "right", sortValue: (l) => l.principal, cell: (l) => <Money value={l.principal} currency={cur} /> },
              { key: "inst", header: "Installment", align: "right", hideBelow: "sm", cell: (l) => <Money value={l.installment} currency={cur} /> },
              { key: "progress", header: "Repaid", hideBelow: "md", cell: (l) => <div className="w-32"><ProgressBar value={l.repaid} total={l.principal} /><p className="mt-0.5 text-[11px] text-ink-3 num">{formatMoney(l.repaid, cur)}</p></div> },
              { key: "out", header: "Outstanding", align: "right", sortValue: (l) => l.outstanding, cell: (l) => <Money value={l.outstanding} currency={cur} className="font-semibold" /> },
              { key: "status", header: "Status", cell: (l) => <StatusBadge status={l.status} /> },
              { key: "a", header: "", align: "right", cell: (l) => can("salary.edit") && l.status === "active" && (
                <Menu trigger={<IconButton icon="more" label="Loan actions" size="sm" />}>
                  <MenuItem icon="coins" onSelect={() => setRepaying(l)}>Record manual repayment</MenuItem>
                </Menu>
              ) },
            ]}
            rows={rows}
            rowKey={(l) => l.id}
            empty={<EmptyState compact icon="coins" title={status === "active" ? "No active loans or advances" : "Nothing here"} />}
            footer={rows.length ? <TotalsRow cells={[{ content: `Total · ${rows.length}` }, { content: "" }, { content: "", hideBelow: "md" }, { content: "", hideBelow: "lg" }, { content: formatMoney(rows.reduce((s, l) => s + l.principal, 0), cur), align: "right" }, { content: "", hideBelow: "sm" }, { content: "", hideBelow: "md" }, { content: formatMoney(rows.reduce((s, l) => s + l.outstanding, 0), cur), align: "right" }, { content: "" }, { content: "" }]} /> : undefined}
          />
        )}
      </Panel>
      {issuing && <LoanDialog employeeId={null} currency={cur} onClose={() => setIssuing(false)} />}
      {repaying && <RepaymentDialog loan={repaying} currency={cur} onClose={() => setRepaying(null)} />}
    </>
  );
}
