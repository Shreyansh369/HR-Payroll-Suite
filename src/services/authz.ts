/**
 * Authorization: USER + ROLE + COMPANY + DATA SCOPE + PERMISSION.
 * Every procedure checks permissions here; hiding a button is never the control.
 */
import type { Permission } from "@/domain/auth/permissions";
import type { DataScope, Employee, ID, Membership, Role, User } from "@/domain/types";
import type { Repository } from "@/repositories/interfaces";
import { AppError, forbidden } from "@/lib/errors";

export interface Actor {
  userId: ID;
  name: string;
  email: string;
  organizationId: ID;
  companyId: ID;
  role: Pick<Role, "id" | "key" | "name">;
  permissions: ReadonlySet<Permission>;
  scope: DataScope;
  employeeId: ID | null;
  /** For `team` scope: linked employee's direct/indirect reports plus assigned employees. */
  teamEmployeeIds: ReadonlySet<ID>;
  companyIds: ID[];
}

export function hasPermission(actor: Actor, permission: Permission): boolean {
  return actor.permissions.has(permission);
}

export function assertPermission(actor: Actor, permission: Permission | Permission[]): void {
  const list = Array.isArray(permission) ? permission : [permission];
  if (!list.some((p) => actor.permissions.has(p))) throw forbidden();
}

export function assertCompanyAccess(actor: Actor, companyId: ID): void {
  if (actor.companyId !== companyId || !actor.companyIds.includes(companyId)) {
    throw forbidden("You do not have access to this company.");
  }
}

export function canAccessEmployee(actor: Actor, employeeId: ID): boolean {
  if (actor.employeeId === employeeId) return true;
  switch (actor.scope) {
    case "all":
      return true;
    case "team":
      return actor.teamEmployeeIds.has(employeeId);
    case "self":
      return false;
  }
}

/** Throws NOT_FOUND (not FORBIDDEN) so record existence outside scope is not revealed. */
export function assertEmployeeScope(actor: Actor, employeeId: ID): void {
  if (!canAccessEmployee(actor, employeeId)) throw new AppError("NOT_FOUND", "Employee not found.");
}

/** Employee ids visible to the actor, or null when unrestricted. */
export function scopedEmployeeIds(actor: Actor): ID[] | null {
  if (actor.scope === "all") return null;
  const ids = new Set<ID>(actor.scope === "team" ? actor.teamEmployeeIds : []);
  if (actor.employeeId) ids.add(actor.employeeId);
  return [...ids];
}

/** Reports-to closure for a manager. */
export function reportsOf(employees: Pick<Employee, "id" | "managerId">[], managerId: ID): Set<ID> {
  const byManager = new Map<ID, ID[]>();
  for (const e of employees) {
    if (!e.managerId) continue;
    const list = byManager.get(e.managerId) ?? [];
    list.push(e.id);
    byManager.set(e.managerId, list);
  }
  const out = new Set<ID>();
  const stack = [...(byManager.get(managerId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id) || id === managerId) continue;
    out.add(id);
    stack.push(...(byManager.get(id) ?? []));
  }
  return out;
}

export function membershipFor(user: User, companyId: ID | null | undefined): Membership | null {
  if (companyId) return user.memberships.find((m) => m.companyId === companyId) ?? null;
  return user.memberships[0] ?? null;
}

/**
 * Build the actor for a user in a company. Throws when the user has no
 * membership in that company or is disabled.
 */
export async function resolveActor(repo: Repository, userId: ID, companyId: ID | null | undefined): Promise<Actor> {
  const user = await repo.users.get(userId);
  if (!user || user.status === "disabled") throw new AppError("UNAUTHENTICATED", "Your session has ended. Sign in again.");
  const membership = membershipFor(user, companyId) ?? membershipFor(user, null);
  if (!membership) throw forbidden("Your account has no company access. Contact your administrator.");
  const company = await repo.companies.get(membership.companyId);
  if (!company || company.organizationId !== user.organizationId) throw forbidden("You do not have access to this company.");
  const role = await repo.roles.get(membership.roleId);
  if (!role || role.organizationId !== user.organizationId) throw forbidden("Your role is not configured.");

  const permissions = new Set<Permission>([...role.permissions, ...(membership.extraPermissions ?? [])]);
  let team = new Set<ID>();
  if (membership.scope === "team") {
    const employees = await repo.employees.list(membership.companyId);
    if (membership.employeeId) team = reportsOf(employees, membership.employeeId);
    for (const id of membership.assignedEmployeeIds ?? []) team.add(id);
  }
  const companyIds: ID[] = [];
  for (const m of user.memberships) {
    const c = await repo.companies.get(m.companyId);
    if (c && c.organizationId === user.organizationId) companyIds.push(c.id);
  }
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    organizationId: user.organizationId,
    companyId: membership.companyId,
    role: { id: role.id, key: role.key, name: role.name },
    permissions,
    scope: membership.scope,
    employeeId: membership.employeeId ?? null,
    teamEmployeeIds: team,
    companyIds,
  };
}
