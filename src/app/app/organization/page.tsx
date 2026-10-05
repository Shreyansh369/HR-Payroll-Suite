"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useM, useQ } from "@/client/api";
import { useSession } from "@/client/session";
import { PageHeader, Panel, PanelHeader, EmptyState, LoadingRows, Avatar } from "@/components/ui/panel";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Field, FormGrid, Input, Select, Segmented } from "@/components/ui/form";
import { Menu, MenuItem } from "@/components/ui/menu";
import { DataTable } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { Icon } from "@/components/ui/icon";

type Node = { id: string; name: string; position: string; departmentName: string; managerId: string | null; status: string };

function OrgTree({ nodes }: { nodes: Node[] }) {
  const children = useMemo(() => {
    const m = new Map<string | null, Node[]>();
    for (const n of nodes) m.set(n.managerId, [...(m.get(n.managerId) ?? []), n]);
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [nodes]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const render = (n: Node, depth: number): React.ReactNode => {
    const kids = children.get(n.id) ?? [];
    const isCollapsed = collapsed.has(n.id);
    return (
      <li key={n.id}>
        <div className="flex items-center gap-2 rounded-md py-1 pr-2 hover:bg-surface-2" style={{ paddingLeft: depth * 22 + 4 }}>
          {kids.length ? (
            <button
              type="button"
              aria-label={isCollapsed ? `Expand ${n.name}` : `Collapse ${n.name}`}
              aria-expanded={!isCollapsed}
              onClick={() => setCollapsed((s) => { const x = new Set(s); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x; })}
              className="flex h-5 w-5 items-center justify-center rounded text-ink-3 hover:bg-surface-3"
            >
              <Icon name={isCollapsed ? "chevronRight" : "chevronDown"} size="sm" />
            </button>
          ) : (
            <span className="w-5" />
          )}
          <Avatar name={n.name} size="sm" />
          <Link href={`/app/employees/${n.id}`} className="min-w-0 flex-1">
            <span className="text-[13px] font-medium hover:underline">{n.name}</span>
            <span className="ml-2 text-[12px] text-ink-3">{n.position}</span>
          </Link>
          <span className="hidden text-[11.5px] text-ink-3 sm:inline">{n.departmentName}</span>
          {kids.length > 0 && <span className="rounded-full bg-surface-3 px-1.5 text-[11px] text-ink-2 num">{kids.length}</span>}
        </div>
        {kids.length > 0 && !isCollapsed && <ul>{kids.map((k) => render(k, depth + 1))}</ul>}
      </li>
    );
  };
  const roots = children.get(null) ?? [];
  if (!roots.length) return <EmptyState compact icon="hierarchy" title="No reporting lines yet" />;
  return <ul className="p-2">{roots.map((r) => render(r, 0))}</ul>;
}

function DepartmentDialog({ dep, deps, onClose }: { dep: { id: string; name: string; code: string; parentId?: string | null } | null; deps: { id: string; name: string }[]; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(dep?.name ?? "");
  const [code, setCode] = useState(dep?.code ?? "");
  const [parentId, setParent] = useState(dep?.parentId ?? "");
  const save = useM("departments.save", { onSuccess: () => { toast.success(dep ? "Department updated" : "Department created"); onClose(); }, onError: (e) => toast.error("Not saved", e.message) });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={dep ? "Edit department" : "New department"}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!name.trim() || !code.trim()} onClick={() => save.mutate({ id: dep?.id, name, code, parentId: parentId || null })}>Save</Button>
        </>
      }
    >
      <FormGrid cols={2}>
        <Field label="Name" required className="sm:col-span-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Code" required hint="Short code used in reports and imports">
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={12} />
        </Field>
        <Field label="Parent">
          <Select value={parentId} onChange={(e) => setParent(e.target.value)}>
            <option value="">None</option>
            {deps.filter((d) => d.id !== dep?.id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
      </FormGrid>
    </Dialog>
  );
}

export default function OrganizationPage() {
  const { can } = useSession();
  const toast = useToast();
  const [view, setView] = useState<"chart" | "departments">("chart");
  const chart = useQ("employees.orgChart", {});
  const deps = useQ("departments.list", {});
  const [editing, setEditing] = useState<{ id: string; name: string; code: string; parentId?: string | null } | null | "new">(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const del = useM("departments.delete", { onSuccess: () => { toast.success("Department deleted"); setDeleting(null); }, onError: (e) => toast.error("Not deleted", e.message) });
  const canEdit = can("company.manage") || can("employee.edit");
  const depName = new Map(deps.data?.map((d) => [d.id, d.name]) ?? []);

  return (
    <>
      <PageHeader
        title="Organization"
        description="Reporting lines and departments. Changes to a person's manager or department are recorded from their profile so history is preserved."
        actions={
          <>
            <Segmented label="View" value={view} onChange={setView} options={[{ value: "chart", label: "Org chart" }, { value: "departments", label: "Departments" }]} />
            {view === "departments" && canEdit && <Button variant="primary" icon="add" onClick={() => setEditing("new")}>New department</Button>}
          </>
        }
      />
      {view === "chart" ? (
        <Panel>
          <PanelHeader title="Reporting lines" description={chart.data ? `${chart.data.length} current employees` : undefined} />
          {chart.data ? <OrgTree nodes={chart.data} /> : <LoadingRows />}
        </Panel>
      ) : (
        <Panel>
          {deps.data ? (
            <DataTable
              columns={[
                { key: "name", header: "Department", sortValue: (d) => d.name, cell: (d) => <Link href={`/app/employees?dept=${d.id}`} className="font-medium hover:underline">{d.name}</Link> },
                { key: "code", header: "Code", cell: (d) => <span className="font-mono text-[12px] text-ink-2">{d.code}</span> },
                { key: "parent", header: "Parent", hideBelow: "sm", cell: (d) => <span className="text-ink-2">{d.parentId ? depName.get(d.parentId) : "—"}</span> },
                { key: "count", header: "Headcount", align: "right", sortValue: (d) => d.headcount, cell: (d) => d.headcount },
                {
                  key: "actions",
                  header: "",
                  align: "right",
                  cell: (d) =>
                    canEdit && (
                      <Menu trigger={<IconButton icon="more" label={`Actions for ${d.name}`} size="sm" />}>
                        <MenuItem icon="edit" onSelect={() => setEditing(d)}>Edit</MenuItem>
                        <MenuItem icon="delete" tone="danger" disabled={d.headcount > 0} hint={d.headcount > 0 ? "has staff" : undefined} onSelect={() => setDeleting(d)}>Delete</MenuItem>
                      </Menu>
                    ),
                },
              ]}
              rows={deps.data}
              rowKey={(d) => d.id}
              empty={<EmptyState compact icon="building" title="No departments" action={canEdit ? <Button size="sm" onClick={() => setEditing("new")}>New department</Button> : undefined} />}
            />
          ) : (
            <LoadingRows />
          )}
        </Panel>
      )}
      {editing && <DepartmentDialog dep={editing === "new" ? null : editing} deps={deps.data ?? []} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title={`Delete ${deleting?.name}?`} confirmLabel="Delete" tone="danger" loading={del.isPending} onConfirm={() => deleting && del.mutate({ id: deleting.id })} />
    </>
  );
}
