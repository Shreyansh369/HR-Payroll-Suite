import { z } from "zod";
import type { EmployeeDocument } from "@/domain/types";
import { audit, companyToday, idSchema, isoDate, mutation, nonEmpty, nowISO, optionalText, query } from "@/services/core";
import { displayName, getScopedEmployee, scopeWhere } from "@/services/helpers";
import { canAccessEmployee, hasPermission } from "@/services/authz";
import { ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, base64DecodedLength, base64ToBytes, bytesToBase64, safeFileName, sha256Hex, sniffMatches } from "@/lib/bytes";
import { addDays } from "@/lib/dates";
import { forbidden, notFound, validation } from "@/lib/errors";

const category = z.enum(["contract", "identification", "work_permit", "certification", "policy", "tax", "medical", "performance", "other"]);

function canView(ctx: Parameters<typeof getScopedEmployee>[0], doc: EmployeeDocument): boolean {
  const own = doc.employeeId !== null && doc.employeeId === ctx.actor.employeeId;
  if (own && doc.visibility === "employee") return true;
  if (!hasPermission(ctx.actor, "documents.view")) return false;
  if (doc.employeeId === null) return ctx.actor.scope === "all";
  if (own) return ctx.actor.scope === "all";
  return canAccessEmployee(ctx.actor, doc.employeeId);
}

export const documentProcedures = {
  "documents.list": query({
    input: z.object({
      employeeId: idSchema.optional(),
      category: category.optional(),
      expiringWithinDays: z.number().int().min(0).max(3650).optional(),
      search: z.string().max(100).optional(),
    }),
    permission: ["documents.view", "self.view"],
    handler: async (ctx, input) => {
      const today = await companyToday(ctx);
      const rows = await ctx.repo.documents.list(ctx.actor.companyId, {
        where: { employeeId: input.employeeId, category: input.category },
        range: input.expiringWithinDays !== undefined ? { field: "expiryDate", lte: addDays(today, input.expiringWithinDays) } : undefined,
        search: input.search,
      });
      const visible = rows.filter((d) => canView(ctx, d));
      const employees = await ctx.repo.employees.list(ctx.actor.companyId, { where: scopeWhere(ctx.actor) });
      const emp = new Map(employees.map((e) => [e.id, e]));
      return visible.map((d) => {
        const e = d.employeeId ? emp.get(d.employeeId) : null;
        return {
          ...d,
          storageKey: undefined,
          employeeName: e ? displayName(e) : d.employeeId ? "Employee" : "Company-wide",
          employeeCode: e?.employeeCode ?? "",
          expired: !!d.expiryDate && d.expiryDate < today,
          canDelete: hasPermission(ctx.actor, "documents.delete") && (d.employeeId === null ? ctx.actor.scope === "all" : canAccessEmployee(ctx.actor, d.employeeId)),
          canEdit: hasPermission(ctx.actor, "documents.upload") && (d.employeeId === null ? ctx.actor.scope === "all" : canAccessEmployee(ctx.actor, d.employeeId)),
        };
      });
    },
  }),

  "documents.upload": mutation({
    input: z.object({
      employeeId: idSchema.nullable(),
      category,
      title: nonEmpty(150),
      fileName: nonEmpty(200),
      mimeType: z.string().max(120),
      contentBase64: z.string().min(1),
      expiryDate: isoDate.nullable().default(null),
      visibility: z.enum(["hr", "employee"]),
      notes: optionalText(500),
    }),
    permission: "documents.upload",
    feature: "hr",
    handler: async (ctx, input) => {
      if (input.employeeId) await getScopedEmployee(ctx, input.employeeId);
      else if (ctx.actor.scope !== "all") throw forbidden();
      if (!ALLOWED_DOCUMENT_TYPES[input.mimeType]) {
        throw validation(`File type not allowed. Upload ${Object.values(ALLOWED_DOCUMENT_TYPES).map((t) => t.label).join(", ")}.`);
      }
      const ext = input.fileName.split(".").pop()?.toLowerCase() ?? "";
      if (!ALLOWED_DOCUMENT_TYPES[input.mimeType].ext.includes(ext)) throw validation("The file extension does not match its type.");
      if (base64DecodedLength(input.contentBase64) > MAX_DOCUMENT_BYTES) throw validation("Files must be 8 MB or smaller.");
      const bytes = base64ToBytes(input.contentBase64);
      if (bytes.length === 0) throw validation("The file is empty.");
      if (!sniffMatches(input.mimeType, bytes)) throw validation("The file content does not match its type, or the file type is not allowed.");
      const id = ctx.ids("doc");
      const storageKey = `${ctx.actor.companyId}/${id}`;
      const now = nowISO(ctx);
      const doc: EmployeeDocument = {
        id,
        companyId: ctx.actor.companyId,
        employeeId: input.employeeId,
        category: input.category,
        title: input.title,
        fileName: safeFileName(input.fileName),
        mimeType: input.mimeType,
        size: bytes.length,
        checksum: await sha256Hex(bytes),
        storageKey,
        expiryDate: input.expiryDate,
        visibility: input.visibility,
        uploadedBy: ctx.actor.userId,
        uploadedByName: ctx.actor.name,
        notes: input.notes,
        createdAt: now,
        updatedAt: now,
      };
      await ctx.storage.put(storageKey, bytes, input.mimeType);
      try {
        await ctx.repo.documents.insert(doc);
      } catch (e) {
        await ctx.storage.delete(storageKey);
        throw e;
      }
      await audit(ctx, { action: "document.uploaded", entityType: "document", entityId: id, summary: `Uploaded "${doc.title}" (${doc.fileName})`, after: { ...doc, storageKey: undefined } });
      return { ...doc, storageKey: undefined };
    },
  }),

  "documents.download": mutation({
    input: z.object({ id: idSchema }),
    permission: ["documents.view", "self.view"],
    handler: async (ctx, { id }) => {
      const doc = await ctx.repo.documents.get(ctx.actor.companyId, id);
      if (!doc || !canView(ctx, doc)) throw notFound("Document");
      const bytes = await ctx.storage.get(doc.storageKey);
      if (!bytes) throw notFound("Document file");
      await audit(ctx, { action: "document.downloaded", entityType: "document", entityId: id, summary: `Downloaded "${doc.title}"` });
      return { fileName: doc.fileName, mimeType: doc.mimeType, contentBase64: bytesToBase64(bytes) };
    },
  }),

  "documents.update": mutation({
    input: z.object({ id: idSchema, title: nonEmpty(150), category, expiryDate: isoDate.nullable(), visibility: z.enum(["hr", "employee"]), notes: optionalText(500) }),
    permission: "documents.upload",
    handler: async (ctx, input) => {
      const doc = await ctx.repo.documents.get(ctx.actor.companyId, input.id);
      if (!doc || !canView(ctx, doc)) throw notFound("Document");
      if (doc.employeeId && !canAccessEmployee(ctx.actor, doc.employeeId)) throw notFound("Document");
      const { id, ...patch } = input;
      const updated = await ctx.repo.documents.update(ctx.actor.companyId, id, { ...patch, updatedAt: nowISO(ctx) });
      await audit(ctx, { action: "document.updated", entityType: "document", entityId: id, summary: `Updated "${input.title}"`, before: { title: doc.title, category: doc.category, expiryDate: doc.expiryDate, visibility: doc.visibility }, after: patch });
      return { ...updated, storageKey: undefined };
    },
  }),

  "documents.delete": mutation({
    input: z.object({ id: idSchema, reason: nonEmpty(300) }),
    permission: "documents.delete",
    handler: async (ctx, { id, reason }) => {
      const doc = await ctx.repo.documents.get(ctx.actor.companyId, id);
      if (!doc || !canView(ctx, doc)) throw notFound("Document");
      if (doc.employeeId && !canAccessEmployee(ctx.actor, doc.employeeId)) throw notFound("Document");
      await ctx.repo.documents.remove(ctx.actor.companyId, id);
      await ctx.storage.delete(doc.storageKey);
      await audit(ctx, { action: "document.deleted", entityType: "document", entityId: id, summary: `Deleted "${doc.title}" (${doc.fileName})`, before: { ...doc, storageKey: undefined }, reason });
      return { ok: true };
    },
  }),
};
