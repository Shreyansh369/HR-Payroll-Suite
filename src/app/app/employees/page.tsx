"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQ } from "@/client/api";
import { useSession } from "@/client/session";
import type { EmployeeListItem } from "@/services/procedures/employees";
import { PageHeader, Panel, EmptyState, LoadingRows, ErrorState, Avatar } from "@/components/ui/panel";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { DataTable, Pagination, type Column } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { EMPLOYMENT_TYPE_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/dates";

type Status = EmployeeListItem["status"];
const STATUS_PRESETS: Record<string, Status[] | undefined> = {
  current: ["active", "onboarding", "on_leave"],
  active: ["active"],
  onboarding: ["onboarding"],
  on_leave: ["on_leave"],
  terminated: ["terminated"],
  archived: ["archived"],
  all: undefined,
};

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Directory() {
  const { can } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [status, setStatus] = useState(params.get("status") ?? "current");
  const [departmentId, setDepartmentId] = useState(params.get("dept") ?? "");
  const [managerId, setManagerId] = useState("");
  const [employmentType, setEmploymentType] = useState("");
  const [workLocation, setWorkLocation] = useState("");
  const [sort, setSort] = useState<"name" | "employeeCode" | "hireDate" | "position" | "status">("name");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const q = useDebounced(search);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset paging when filters change
    setPage(1);
  }, [q, status, departmentId, managerId, employmentType, workLocation, pageSize]);

  const deps = useQ("departments.list", {});
  const filters = useQ("employees.filters", {});
  const list = useQ(
    "employees.list",
    {
      search: q || undefined,
      status: STATUS_PRESETS[status],
      departmentId: departmentId || undefined,
      managerId: managerId || undefined,
      employmentType: (employmentType || undefined) as EmployeeListItem["employmentType"] | undefined,
      workLocation: workLocation || undefined,
      sort,
      dir,
      page,
      pageSize,
    },
    { placeholderData: (prev) => prev },
  );

  const sortHeader = (key: typeof sort, label: string) => (
    <button
      type="button"
      onClick={() => {
        if (sort === key) setDir(dir === "asc" ? "desc" : "asc");
        else {
          setSort(key);
          setDir(key === "hireDate" ? "desc" : "asc");
        }
      }}
      className="inline-flex items-center gap-1 uppercase hover:text-ink"
    >
      {label}
      {sort === key && <Icon name={dir === "asc" ? "sortUp" : "sortDown"} size="sm" />}
    </button>
  );

  const columns: Column<EmployeeListItem>[] = [
    {
      key: "name",
      header: sortHeader("name", "Employee"),
      cell: (e) => (
        <Link href={`/app/employees/${e.id}`} className="flex min-w-[200px] items-center gap-2.5" onClick={(ev) => ev.stopPropagation()}>
          <Avatar name={e.name} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink hover:underline">{e.name}</span>
            {e.name !== e.legalName && <span className="block truncate text-[11.5px] text-ink-3">{e.legalName}</span>}
          </span>
        </Link>
      ),
    },
    { key: "code", header: sortHeader("employeeCode", "ID"), cell: (e) => <span className="font-mono text-[12px] text-ink-2">{e.employeeCode}</span> },
    { key: "position", header: sortHeader("position", "Position"), cell: (e) => <span className="block max-w-[220px] truncate">{e.position}</span>, hideBelow: "md" },
    { key: "dept", header: "Department", cell: (e) => e.departmentName, hideBelow: "lg" },
    { key: "manager", header: "Manager", cell: (e) => <span className="text-ink-2">{e.managerName}</span>, hideBelow: "xl" },
    { key: "type", header: "Type", cell: (e) => <span className="text-ink-2">{EMPLOYMENT_TYPE_LABELS[e.employmentType]}</span>, hideBelow: "xl" },
    { key: "hire", header: sortHeader("hireDate", "Hired"), cell: (e) => <span className="num text-ink-2">{formatDate(e.hireDate)}</span>, hideBelow: "sm" },
    {
      key: "status",
      header: sortHeader("status", "Status"),
      cell: (e) => (
        <span className="flex items-center gap-1.5">
          <StatusBadge status={e.status} />
          {e.terminationDate && e.status !== "terminated" && e.status !== "archived" && <span className="text-[11.5px] text-ink-3">leaving {formatDate(e.terminationDate, { year: false })}</span>}
        </span>
      ),
    },
  ];

  const activeFilters = [departmentId, managerId, employmentType, workLocation].filter(Boolean).length;

  return (
    <>
      <PageHeader
        title="Employees"
        description={list.data ? `${list.data.total} ${status === "current" ? "current employees" : "employees"}` : undefined}
        actions={
          <>
            {can("imports.run") && can("employee.create") && <ButtonLink href="/app/import?entity=employees" icon="import">Import</ButtonLink>}
            {can("employee.create") && <ButtonLink href="/app/employees/new" variant="primary" icon="userAdd">Add employee</ButtonLink>}
          </>
        }
      />
      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <Icon name="search" size="sm" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, ID, email or position" className="pl-8" aria-label="Search employees" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className="w-36">
            <option value="current">Current</option>
            <option value="active">Active</option>
            <option value="onboarding">Onboarding</option>
            <option value="on_leave">On leave</option>
            <option value="terminated">Terminated</option>
            <option value="archived">Archived</option>
            <option value="all">All statuses</option>
          </Select>
          <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} aria-label="Department" className="w-44">
            <option value="">All departments</option>
            {deps.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select value={managerId} onChange={(e) => setManagerId(e.target.value)} aria-label="Manager" className="w-44 max-md:hidden">
            <option value="">Any manager</option>
            {filters.data?.managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          <Select value={employmentType} onChange={(e) => setEmploymentType(e.target.value)} aria-label="Employment type" className="w-36 max-lg:hidden">
            <option value="">Any type</option>
            {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          {(filters.data?.locations.length ?? 0) > 1 && (
            <Select value={workLocation} onChange={(e) => setWorkLocation(e.target.value)} aria-label="Location" className="w-36 max-lg:hidden">
              <option value="">Any location</option>
              {filters.data?.locations.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          )}
          {(activeFilters > 0 || search) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setDepartmentId("");
                setManagerId("");
                setEmploymentType("");
                setWorkLocation("");
              }}
            >
              Clear
            </Button>
          )}
        </div>
        {list.isLoading ? (
          <LoadingRows rows={10} />
        ) : list.error ? (
          <ErrorState message={list.error.message} onRetry={() => list.refetch()} />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={list.data!.items}
              rowKey={(e) => e.id}
              onRowClick={(e) => router.push(`/app/employees/${e.id}`)}
              caption="Employee directory"
              empty={
                <EmptyState
                  icon="users"
                  title={search || activeFilters ? "No employees match these filters" : "No employees yet"}
                  description={search || activeFilters ? "Try a different search or clear the filters." : "Add employees one at a time or import them from a spreadsheet."}
                  action={!search && !activeFilters && can("employee.create") ? <ButtonLink href="/app/employees/new" variant="primary" icon="userAdd">Add employee</ButtonLink> : undefined}
                />
              }
            />
            <div className="flex items-center justify-between">
              <Pagination page={page} pageSize={pageSize} total={list.data!.total} onPage={setPage} />
              <label className="mr-3 flex items-center gap-2 text-[12px] text-ink-3 max-sm:hidden">
                Rows
                <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="rounded border border-line bg-surface px-1 py-0.5 text-[12px]">
                  {[25, 50, 100].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
          </>
        )}
      </Panel>
    </>
  );
}

export default function EmployeesPage() {
  return (
    <Suspense>
      <Directory />
    </Suspense>
  );
}
