import { desc, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { reportAuditLogs } from "../db/schema.js";
import { appendAuditLog } from "./audit.service.js";

const columns = ["id", "occurredAt", "reportId", "actorId", "actorType", "actionType", "snapshotBefore", "snapshotAfter", "requestId", "ipHash", "userAgent", "prevEntryHash", "entryHash"] as const;
type ExportEntry = Pick<typeof reportAuditLogs.$inferSelect, typeof columns[number]>;

export function serializeAuditExport(rows: ExportEntry[], format: "csv" | "json") {
  // Keep the exported shape explicit and preserve original JSON values in JSON exports.
  const entries = rows.map(row => Object.fromEntries(columns.map(key => [key, row[key]])));
  if (format === "json") return JSON.stringify(entries, null, 2);
  const cell = (value: unknown) => {
    let text = value == null ? "" : value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
    // Quoting alone does not stop spreadsheet formula execution.
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return "\uFEFF" + [columns.join(","), ...entries.map(row => columns.map(key => cell(row[key])).join(","))].join("\r\n") + "\r\n";
}

export async function exportAuditLogs(input: { ids: number[]; format: "csv" | "json"; actorId: string; rawIp?: string; userAgent?: string }, database: Pick<typeof db, "transaction"> = db) {
  return database.transaction(async tx => {
    const rows = await tx.select().from(reportAuditLogs).where(inArray(reportAuditLogs.id, input.ids)).orderBy(desc(reportAuditLogs.id));
    if (rows.length !== input.ids.length) throw new Error("Sebagian entri tidak tersedia. Segarkan riwayat sebelum mengekspor.");
    const content = serializeAuditExport(rows, input.format);
    const record = await appendAuditLog({
      actorId: input.actorId, actorType: "ADMIN", actionType: "LOG_EXPORTED",
      snapshotAfter: { format: input.format, count: rows.length, entryIds: rows.map(row => row.id), scope: "FILTERED_LOADED_ENTRIES" },
      rawIp: input.rawIp, userAgent: input.userAgent,
    }, tx);
    return { content, count: rows.length, auditEntryId: record.id, filename: `sijago-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.${input.format}`, mimeType: input.format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8" };
  });
}
