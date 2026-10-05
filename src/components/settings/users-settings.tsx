"use client";

import { useState } from "react";
import { useM, useQ } from "@/client/api";
import { useSession } from "@/client/session";
import type { DataScope, Membership, Role } from "@/domain/types";
import { PERMISSION_GROUPS, PERMISSION_LABELS, type Permission } from "@/domain/auth/permissions";
import { Panel, PanelHeader, LoadingRows, ErrorState, Callout, Avatar } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { DataTable } from "@/components/ui/table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { IS_DEMO } from "@/config/env";
import { formatDateTime } from "@/lib/dates";

type UserRow = { id: string; email: string; name: string; status: string; memberships: Membership[]; lastLoginAt: string | null; twoFactorEnabled: boolean };

const SCOPE_LABEL: Record<DataScope, string> = { all: "All employees", team: "Their team", self: "Only themselves" };

function UserDialog({ user, roles, onClose }: { user: UserRow | null; roles: Role[]; onClose: () => void }) {
  const toast = useToast();
  const { ctx } = useSession();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"active" | "disabled">((user?.status as "active" | "disabled") ?? "active");
  const visibleCompanies = ctx.companies;
  const [memberships, setMemberships] = useState<Membership[]>(
    () => user?.memberships.filter((m) => visibleCompanies.some((c) => c.id === m.companyId)) ?? [{ companyId: ctx.company.id, roleId: roles.find((r) => r.key === "employee")?.id ?? roles[0].id, scope: "self", employeeId: null }],
  );
  const people = useQ("employees.options", { includeInactive: false });
  const create = useM("users.create", { onSuccess: () => { toast.success("User created", IS_DEMO ? "In the demo, every account uses the demo password." : "Share the initial password securely."); onClose(); }, onError: (e) => toast.error("Not saved", e.message) });
  const update = useM("users.update", { onSuccess: () => { toast.success("Access updated"); onClose(); }, onError: (e) => toast.error("Not saved", e.message) });
  const err = create.error ?? update.error;
  const setM = (i: number, patch: Partial<Membership>) => setMemberships((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const payload = memberships.map((m) => ({ companyId: m.companyId, roleId: m.roleId, scope: m.scope, employeeId: m.employeeId ?? null, assignedEmployeeIds: m.assignedEmployeeIds ?? [], extraPermissions: m.extraPermissions ?? [] }));
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onClose()}
      title={user ? `Access for ${user.name}` : "Add user"}
      description="Access = role × company × data scope. Grant salary access to an HR manager by adding the permission explicitly."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={create.isPending || update.isPending} disabled={!name.trim() || !email.trim() || memberships.length === 0} onClick={() => (user ? update.mutate({ id: user.id, name, status, memberships: payload }) : create.mutate({ name, email, memberships: payload, initialPassword: password || undefined }))}>{user ? "Save access" : "Create user"}</Button></>}
    >
      <div className="space-y-4">
        {err && <Callout tone="danger">{err.message}</Callout>}
        <FormGrid cols={2}>
          <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Email" required><Input type="email" value={email} disabled={!!user} onChange={(e) => setEmail(e.target.value)} /></Field>
          {!user && !IS_DEMO && <Field label="Initial password" required hint="At least 12 characters. The user should change it after first sign-in."><Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>}
          {user && user.id !== ctx.user.id && (
            <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value as "active" | "disabled")}><option value="active">Active</option><option value="disabled">Disabled (cannot sign in)</option></Select></Field>
          )}
        </FormGrid>
        <div className="space-y-3">
          {memberships.map((m, i) => {
            const role = roles.find((r) => r.id === m.roleId);
            const sameCompany = m.companyId === ctx.company.id;
            return (
              <div key={i} className="rounded-lg border border-line p-3">
                <FormGrid cols={3}>
                  <Field label="Company">
                    <Select value={m.companyId} onChange={(e) => setM(i, { companyId: e.target.value, employeeId: null })}>
                      {visibleCompanies.map((c) => <option key={c.id} value={c.id} disabled={c.id !== m.companyId && memberships.some((x) => x.companyId === c.id)}>{c.tradingName}</option>)}
                    </Select>
                  </Field>
                  <Field label="Role">
                    <Select value={m.roleId} onChange={(e) => { const r = roles.find((x) => x.id === e.target.value); setM(i, { roleId: e.target.value, scope: r?.defaultScope ?? m.scope }); }}>
                      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Data scope">
                    <Select value={m.scope} onChange={(e) => setM(i, { scope: e.target.value as DataScope })}>
                      {(Object.keys(SCOPE_LABEL) as DataScope[]).map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
                    </Select>
                  </Field>
                  <Field label="Linked employee record" hint={sameCompany ? "Enables self-service and team scope" : "Switch to this company to link a record"} className="sm:col-span-2">
                    <Select value={m.employeeId ?? ""} disabled={!sameCompany} onChange={(e) => setM(i, { employeeId: e.target.value || null })}>
                      <option value="">Not linked</option>
                      {sameCompany && people.data?.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.employeeCode})</option>)}
                    </Select>
                  </Field>
                  <div className="flex items-end justify-end">
                    {memberships.length > 1 && <Button size="sm" variant="ghost" onClick={() => setMemberships((ms) => ms.filter((_, j) => j !== i))}>Remove access</Button>}
                  </div>
                </FormGrid>
                {role && !role.permissions.includes("salary.view") && (
                  <div className="mt-2">
                    <Checkbox
                      label="Also grant salary access"
                      description="Adds salary.view on top of the role for this company only."
                      checked={(m.extraPermissions ?? []).includes("salary.view")}
                      onChange={(v) => setM(i, { extraPermissions: v ? [...(m.extraPermissions ?? []), "salary.view"] : (m.extraPermissions ?? []).filter((p) => p !== "salary.view") })}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {memberships.length < visibleCompanies.length && (
            <Button size="sm" icon="add" onClick={() => setMemberships((ms) => [...ms, { companyId: visibleCompanies.find((c) => !ms.some((m) => m.companyId === c.id))!.id, roleId: roles.find((r) => r.key === "employee")?.id ?? roles[0].id, scope: "self", employeeId: null }])}>Add company access</Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function RoleDialog({ role, onClose }: { role: Role | null; onClose: () => void }) {
  const toast = useToast();
  const { ctx } = useSession();
  const readOnly = !!role?.system;
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [scope, setScope] = useState<DataScope>(role?.defaultScope ?? "all");
  const [perms, setPerms] = useState<Set<Permission>>(new Set(role?.permissions ?? ["self.view"]));
  const save = useM("roles.save", { onSuccess: () => { toast.success("Role saved"); onClose(); }, onError: (e) => toast.error("Not saved", e.message) });
  return (
    <Dialog open size="xl" onOpenChange={(o) => !o && onClose()} title={role ? role.name : "New role"} description={readOnly ? "System roles are fixed. Duplicate one as a custom role to change its permissions." : "Custom roles can be assigned like system roles."} footer={<><Button variant="ghost" onClick={onClose}>{readOnly ? "Close" : "Cancel"}</Button>{!readOnly && <Button variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate({ id: role?.id, name, description, permissions: [...perms], defaultScope: scope })}>Save role</Button>}</>}>
      <div className="space-y-4">
        {save.error && <Callout tone="danger">{save.error.message}</Callout>}
        {!readOnly && (
          <FormGrid cols={3}>
            <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Default data scope"><Select value={scope} onChange={(e) => setScope(e.target.value as DataScope)}>{(Object.keys(SCOPE_LABEL) as DataScope[]).map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}</Select></Field>
            <Field label="Description"><Textarea rows={1} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          </FormGrid>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PERMISSION_GROUPS.map((g) => (
            <div key={g.label}>
              <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-ink-3">{g.label}</p>
              <div className="space-y-1">
                {g.permissions.map((p) => (
                  <Checkbox key={p} label={PERMISSION_LABELS[p]} disabled={readOnly || !ctx.permissions.includes(p)} checked={perms.has(p)} onChange={(v) => setPerms((s) => { const x = new Set(s); if (v) x.add(p); else x.delete(p); return x; })} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

export function UsersSettings() {
  const { ctx, can } = useSession();
  const q = useQ("users.list", {}, { enabled: can("users.manage") });
  const roles = useQ("roles.list", {});
  const [editing, setEditing] = useState<UserRow | null | "new">(null);
  const [roleOpen, setRoleOpen] = useState<Role | null | "new">(null);
  if (!can("users.manage")) return <Callout tone="neutral">You can view roles but not manage users.</Callout>;
  if (q.isLoading || roles.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState message={q.error.message} />;
  const roleName = new Map(q.data!.roles.map((r) => [r.id, r.name]));
  const companyName = new Map(ctx.companies.map((c) => [c.id, c.tradingName]));
  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Users" description={`${q.data!.users.length} users in your organisation`} actions={<Button size="sm" variant="primary" icon="userAdd" onClick={() => setEditing("new")}>Add user</Button>} />
        <DataTable
          onRowClick={(u) => setEditing(u)}
          columns={[
            { key: "name", header: "User", sortValue: (u) => u.name, cell: (u) => <span className="flex items-center gap-2.5"><Avatar name={u.name} size="sm" /><span><span className="block font-medium">{u.name}</span><span className="block text-[11.5px] text-ink-3">{u.email}</span></span></span> },
            { key: "access", header: "Access", cell: (u) => <ul className="space-y-0.5 text-[12.5px]">{u.memberships.map((m) => <li key={m.companyId}><span className="font-medium">{roleName.get(m.roleId)}</span> <span className="text-ink-3">· {companyName.get(m.companyId) ?? "Other company"} · {SCOPE_LABEL[m.scope].toLowerCase()}{m.extraPermissions?.includes("salary.view") ? " · + salary" : ""}</span></li>)}</ul> },
            { key: "2fa", header: "2FA", hideBelow: "md", cell: (u) => (u.twoFactorEnabled ? <Badge tone="success">On</Badge> : <span className="text-ink-4">Off</span>) },
            { key: "login", header: "Last sign-in", hideBelow: "lg", cell: (u) => <span className="text-[12px] text-ink-2">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}</span> },
            { key: "status", header: "Status", cell: (u) => <StatusBadge status={u.status === "active" ? "active" : "inactive"} /> },
          ]}
          rows={q.data!.users}
          rowKey={(u) => u.id}
        />
      </Panel>
      <Panel>
        <PanelHeader title="Roles" description="Permissions are explicit; data scope limits which employees a role can see." actions={can("roles.manage") && <Button size="sm" icon="add" onClick={() => setRoleOpen("new")}>Custom role</Button>} />
        <ul className="divide-y divide-line">
          {(roles.data ?? []).map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setRoleOpen(r)} className="flex w-full items-start justify-between gap-3 px-4 py-2.5 text-left hover:bg-surface-2">
                <span>
                  <span className="text-[13px] font-medium">{r.name}</span> {r.system ? <Badge>System</Badge> : <Badge tone="info">Custom</Badge>}
                  <span className="mt-0.5 block text-[12px] text-ink-3">{r.description}</span>
                </span>
                <span className="shrink-0 text-[12px] text-ink-3">{r.permissions.length} permissions · {SCOPE_LABEL[r.defaultScope].toLowerCase()}</span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      {editing && <UserDialog user={editing === "new" ? null : editing} roles={q.data!.roles} onClose={() => setEditing(null)} />}
      {roleOpen && <RoleDialog role={roleOpen === "new" ? null : roleOpen} onClose={() => setRoleOpen(null)} />}
    </div>
  );
}
