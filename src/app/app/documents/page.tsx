"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQ } from "@/client/api";
import { useSession } from "@/client/session";
import type { DocumentCategory } from "@/domain/types";
import { PageHeader, Panel, LoadingRows, ErrorState } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Input, Select, Segmented } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { DocumentsTable, UploadDocumentDialog } from "@/components/hr/documents";
import { DOCUMENT_CATEGORY_LABELS } from "@/config/defaults";

function DocumentsInner() {
  const { can } = useSession();
  const params = useSearchParams();
  const initialExpiring = params.get("expiring");
  const [expiry, setExpiry] = useState<"all" | "30" | "90" | "expired">(initialExpiring === "0" ? "expired" : initialExpiring ? "30" : "all");
  const [category, setCategory] = useState<DocumentCategory | "">("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  const q = useQ("documents.list", {
    category: category || undefined,
    expiringWithinDays: expiry === "all" ? undefined : expiry === "expired" ? 0 : Number(expiry),
    search: debounced || undefined,
  });
  const rows = expiry === "expired" ? q.data?.filter((d) => d.expired) : q.data;
  return (
    <>
      <PageHeader
        title="Documents"
        description="Contracts, identification, permits and certificates. Downloads are authorized per role and recorded in the audit log."
        actions={can("documents.upload") && <Button variant="primary" icon="upload" onClick={() => setUploading(true)}>Upload document</Button>}
      />
      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Icon name="search" size="sm" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Title or file name" className="pl-8" aria-label="Search documents" />
          </div>
          <Select value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory | "")} className="w-48" aria-label="Category">
            <option value="">All categories</option>
            {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Segmented label="Expiry" value={expiry} onChange={setExpiry} options={[{ value: "all", label: "All" }, { value: "30", label: "≤ 30 days" }, { value: "90", label: "≤ 90 days" }, { value: "expired", label: "Expired" }]} />
        </div>
        {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState message={q.error.message} /> : <DocumentsTable rows={rows ?? []} />}
      </Panel>
      {uploading && <UploadDocumentDialog open={uploading} onOpenChange={setUploading} />}
    </>
  );
}

export default function DocumentsPage() {
  return (
    <Suspense>
      <DocumentsInner />
    </Suspense>
  );
}
