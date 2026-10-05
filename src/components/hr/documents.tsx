"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { call, useM, useQ } from "@/client/api";
import { useSession } from "@/client/session";
import type { ProcOutput } from "@/services/registry";
import type { DocumentCategory } from "@/domain/types";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Button, IconButton } from "@/components/ui/button";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { DataTable, type Column } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Callout } from "@/components/ui/panel";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/components/ui/toast";
import { DOCUMENT_CATEGORY_LABELS } from "@/config/defaults";
import { ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "@/lib/bytes";
import { fileToBase64, saveBase64 } from "@/lib/download";
import { formatDate, diffDays } from "@/lib/dates";
import { errorMessage } from "@/client/api";

export type DocRow = ProcOutput<"documents.list">[number];

export async function downloadDocument(id: string) {
  const d = await call("documents.download", { id });
  saveBase64(d.contentBase64, d.fileName, d.mimeType);
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ExpiryBadge({ date, today }: { date: string | null | undefined; today: string }) {
  if (!date) return <span className="text-ink-4">—</span>;
  const days = diffDays(today, date);
  if (days < 0) return <Badge tone="danger">Expired {formatDate(date)}</Badge>;
  if (days <= 30) return <Badge tone="warning">{formatDate(date)} · {days}d</Badge>;
  return <span className="num text-ink-2">{formatDate(date)}</span>;
}

export function DocumentsTable({ rows, showEmployee = true }: { rows: DocRow[]; showEmployee?: boolean }) {
  const toast = useToast();
  const { ctx } = useSession();
  const [deleting, setDeleting] = useState<DocRow | null>(null);
  const [editing, setEditing] = useState<DocRow | null>(null);
  const del = useM("documents.delete", {
    onSuccess: () => {
      toast.success("Document deleted");
      setDeleting(null);
    },
    onError: (e) => toast.error("Could not delete", e.message),
  });
  const columns: Column<DocRow>[] = [
    {
      key: "title",
      header: "Document",
      sortValue: (d) => d.title,
      cell: (d) => (
        <button type="button" className="flex min-w-[200px] items-center gap-2.5 text-left" onClick={() => downloadDocument(d.id).catch((e) => toast.error("Download failed", errorMessage(e)))}>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-ink-3">
            <Icon name="file" size="sm" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium hover:underline">{d.title}</span>
            <span className="block truncate text-[11.5px] text-ink-3">
              {d.fileName} · {formatSize(d.size)}
            </span>
          </span>
        </button>
      ),
    },
    ...(showEmployee
      ? [
          {
            key: "employee",
            header: "Employee",
            sortValue: (d: DocRow) => d.employeeName,
            hideBelow: "md" as const,
            cell: (d: DocRow) => (d.employeeId ? <Link href={`/app/employees/${d.employeeId}`} className="hover:underline">{d.employeeName}</Link> : <span className="text-ink-3">Company-wide</span>),
          },
        ]
      : []),
    { key: "category", header: "Category", sortValue: (d) => d.category, hideBelow: "lg", cell: (d) => <span className="text-ink-2">{DOCUMENT_CATEGORY_LABELS[d.category]}</span> },
    { key: "visibility", header: "Visible to", hideBelow: "xl", cell: (d) => (d.visibility === "employee" ? <Badge tone="info">Employee + HR</Badge> : <Badge>HR only</Badge>) },
    { key: "expiry", header: "Expires", sortValue: (d) => d.expiryDate ?? "9999", cell: (d) => <ExpiryBadge date={d.expiryDate} today={ctx.today} /> },
    { key: "uploaded", header: "Uploaded", sortValue: (d) => d.createdAt, hideBelow: "lg", cell: (d) => <span className="text-ink-2">{formatDate(d.createdAt.slice(0, 10))}</span> },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (d) => (
        <Menu trigger={<IconButton icon="more" label={`Actions for ${d.title}`} size="sm" />}>
          <MenuItem icon="download" onSelect={() => downloadDocument(d.id).catch((e) => toast.error("Download failed", errorMessage(e)))}>
            Download
          </MenuItem>
          {d.canEdit && (
            <MenuItem icon="edit" onSelect={() => setEditing(d)}>
              Edit details
            </MenuItem>
          )}
          {d.canDelete && (
            <MenuItem icon="delete" tone="danger" onSelect={() => setDeleting(d)}>
              Delete
            </MenuItem>
          )}
        </Menu>
      ),
    },
  ];
  return (
    <>
      <DataTable columns={columns} rows={rows} rowKey={(d) => d.id} empty={<EmptyState compact icon="folder" title="No documents" description="Contracts, permits, certificates and policy acknowledgements appear here." />} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.title}"?`}
        description="The file is removed permanently. The audit log keeps a record of the deletion."
        confirmLabel="Delete document"
        tone="danger"
        requireReason
        loading={del.isPending}
        onConfirm={(reason) => deleting && del.mutate({ id: deleting.id, reason })}
      />
      {editing && <EditDocumentDialog doc={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function EditDocumentDialog({ doc, onClose }: { doc: DocRow; onClose: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(doc.title);
  const [category, setCategory] = useState<DocumentCategory>(doc.category);
  const [expiryDate, setExpiry] = useState(doc.expiryDate ?? "");
  const [visibility, setVisibility] = useState(doc.visibility);
  const [notes, setNotes] = useState(doc.notes);
  const update = useM("documents.update", {
    onSuccess: () => {
      toast.success("Document updated");
      onClose();
    },
    onError: (e) => toast.error("Not saved", e.message),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Edit document"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={update.isPending} onClick={() => update.mutate({ id: doc.id, title, category, expiryDate: expiryDate || null, visibility, notes })}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="Title" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <FormGrid cols={2}>
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)}>
              {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Expiry date">
            <Input type="date" value={expiryDate} onChange={(e) => setExpiry(e.target.value)} />
          </Field>
        </FormGrid>
        <Field label="Visible to">
          <Select value={visibility} onChange={(e) => setVisibility(e.target.value as "hr" | "employee")}>
            <option value="hr">HR and administrators only</option>
            <option value="employee">Also the employee (self-service)</option>
          </Select>
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
      </div>
    </Dialog>
  );
}

export function UploadDocumentDialog({ open, onOpenChange, employeeId: fixedEmployee }: { open: boolean; onOpenChange: (o: boolean) => void; employeeId?: string | null }) {
  const toast = useToast();
  const { can } = useSession();
  const people = useQ("employees.options", { includeInactive: true }, { enabled: open && fixedEmployee === undefined && can("employee.view") });
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [employeeId, setEmployeeId] = useState<string>(fixedEmployee ?? "");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<DocumentCategory>("contract");
  const [expiryDate, setExpiry] = useState("");
  const [visibility, setVisibility] = useState<"hr" | "employee">("hr");
  const [notes, setNotes] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = useM("documents.upload", {
    onSuccess: () => {
      toast.success("Document uploaded");
      onOpenChange(false);
      setFile(null);
      setTitle("");
      setExpiry("");
      setNotes("");
    },
    onError: (e) => toast.error("Upload failed", e.message),
  });

  function pick(f: File | null) {
    setFileError(null);
    if (!f) return setFile(null);
    if (!ALLOWED_DOCUMENT_TYPES[f.type]) return setFileError(`"${f.name}" is not an allowed type. Use ${Object.values(ALLOWED_DOCUMENT_TYPES).map((t) => t.label).join(", ")}.`);
    if (f.size > MAX_DOCUMENT_BYTES) return setFileError("Files must be 8 MB or smaller.");
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Upload document"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy || upload.isPending}
            disabled={!file || !title.trim()}
            onClick={async () => {
              if (!file) return;
              setBusy(true);
              try {
                const contentBase64 = await fileToBase64(file);
                upload.mutate({ employeeId: (fixedEmployee ?? employeeId) || null, category, title, fileName: file.name, mimeType: file.type, contentBase64, expiryDate: expiryDate || null, visibility, notes });
              } finally {
                setBusy(false);
              }
            }}
          >
            Upload
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pick(e.dataTransfer.files[0] ?? null);
          }}
          className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-surface-2 px-4 py-6 text-center"
        >
          <Icon name="upload" className="text-ink-3" />
          {file ? (
            <p className="mt-2 text-[13px] font-medium">
              {file.name} <span className="font-normal text-ink-3">· {formatSize(file.size)}</span>
            </p>
          ) : (
            <p className="mt-2 text-[13px] text-ink-2">Drop a file here or</p>
          )}
          <Button size="sm" className="mt-2" onClick={() => fileRef.current?.click()}>
            {file ? "Choose a different file" : "Choose file"}
          </Button>
          <input ref={fileRef} type="file" className="hidden" accept={Object.keys(ALLOWED_DOCUMENT_TYPES).join(",")} onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          <p className="mt-2 text-[11.5px] text-ink-3">PDF, images, Word, Excel, CSV or text · up to 8 MB</p>
        </div>
        {fileError && <Callout tone="danger">{fileError}</Callout>}
        {fixedEmployee === undefined && (
          <Field label="Employee">
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Company-wide document</option>
              {people.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.employeeCode})
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Title" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <FormGrid cols={2}>
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)}>
              {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Expiry date" hint="For permits and certificates">
            <Input type="date" value={expiryDate} onChange={(e) => setExpiry(e.target.value)} />
          </Field>
        </FormGrid>
        <Field label="Visible to">
          <Select value={visibility} onChange={(e) => setVisibility(e.target.value as "hr" | "employee")}>
            <option value="hr">HR and administrators only</option>
            <option value="employee">Also the employee (self-service)</option>
          </Select>
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
      </div>
    </Dialog>
  );
}
