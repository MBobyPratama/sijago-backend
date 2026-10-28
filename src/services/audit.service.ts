import { desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { reportAuditLogs } from "../db/schema.js";
import { computeAuditEntryHash, hashWithSalt } from "../utils/hash.js";

export type AuditActorType = "WARGA_PSEUDONIM" | "ADMIN" | "INSTANSI" | "SISTEM" | "AI";
export type AuditActionType =
  | "AI_GENERATE_SUCCESS"
  | "AI_FALLBACK_TEMPLATE"
  | "SOURCE_FACTS_MODIFIED"
  | "APPROVAL_GRANTED"
  | "APPROVAL_RESET"
  | "REPORT_SUBMITTED"
  | "VERIFY_REPORT"
  | "REJECT_REPORT"
  | "ROUTE_ASSIGNED"
  | "ESCALATION_EMAIL_SENT"
  | "ESCALATION_EMAIL_FAILED"
  | "STATUS_CHANGED"
  | "DUPLICATE_MERGED"
  | "SIGNOFF_SUBMITTED"
  | "REOPENED"
  | "ADMIN_OVERRIDE"
  | "LOG_EXPORTED"
  | "CONFIG_UPDATED";

export interface WriteAuditLogInput {
  reportId?: string | null;
  actorId: string;
  actorType: AuditActorType;
  actionType: AuditActionType;
  snapshotBefore?: unknown;
  snapshotAfter?: unknown;
  requestId?: string;
  rawIp?: string;
  userAgent?: string;
}

/**
 * Menulis entri ke tabel `report_audit_logs` (append-only) lengkap dengan perhitungan
 * `prev_entry_hash` dan `entry_hash` (FR-7.1, FR-7.2, FR-7.5).
 */
export async function appendAuditLog(input: WriteAuditLogInput) {
  const lastLog = await db
    .select({ entryHash: reportAuditLogs.entryHash })
    .from(reportAuditLogs)
    .orderBy(desc(reportAuditLogs.id))
    .limit(1);

  const prevEntryHash =
    lastLog[0]?.entryHash ?? "0000000000000000000000000000000000000000000000000000000000000000";
  const now = new Date();

  const entryHash = computeAuditEntryHash({
    prevEntryHash,
    occurredAtIso: now.toISOString(),
    reportId: input.reportId ?? null,
    actorId: input.actorId,
    actionType: input.actionType,
    snapshotAfter: input.snapshotAfter ?? null,
  });

  const ipHash = hashWithSalt(input.rawIp || "127.0.0.1");

  const [inserted] = await db
    .insert(reportAuditLogs)
    .values({
      occurredAt: now,
      reportId: input.reportId ?? null,
      actorId: input.actorId,
      actorType: input.actorType,
      actionType: input.actionType,
      snapshotBefore: input.snapshotBefore ?? null,
      snapshotAfter: input.snapshotAfter ?? null,
      requestId: input.requestId ?? `req_${Date.now()}`,
      ipHash,
      userAgent: input.userAgent ?? "SIJAGO-Client/1.0",
      prevEntryHash,
      entryHash,
    })
    .returning();

  return inserted;
}
