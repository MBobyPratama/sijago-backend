import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { reports, agencies, escalations, adminNotes, reportDrafts, reportFactVersions } from "../db/schema.js";
import { authContext } from "../auth-context.js";
import { AuthError } from "./auth.service.js";
import { findReportByIdOrCode } from "./moderation.service.js";
import { appendAuditLog } from "./audit.service.js";
import { buildReportDescription } from "../utils/reportDescription.js";
import { buildOfficialEscalationMessage, sendStoredEscalationEmail } from "./email.service.js";

type ForwardInput = { reportIdOrCode: string; agencyCode: string; adminNoteText?: string; rawIp?: string };
const LEASE_MS = 2 * 60 * 1000;

export function createAdminForwardingService(database: Pick<typeof db, "select" | "transaction"> = db, sender = sendStoredEscalationEmail) {
  const adminUser = () => {
    const admin = authContext.getStore();
    if (!admin || !["ADMIN", "SUPER_ADMIN"].includes(admin.role)) throw new AuthError(403, "ADMIN_REQUIRED", "Sesi admin diperlukan.");
    return admin;
  };
  const resultFor = (record: typeof escalations.$inferSelect, agencyName: string) => ({
    escalationId: record.id, agencyName, status: "DITERUSKAN", newStatus: "DITERUSKAN", deliveryStatus: record.deliveryStatus,
    sentViaResend: ["SENT", "DELIVERED"].includes(record.deliveryStatus), messageId: record.providerMessageId || "", failureReason: record.failureReason,
  });
  const deliver = async (record: typeof escalations.$inferSelect, agencyName: string, rawIp?: string) => {
    let sent: Awaited<ReturnType<typeof sender>>;
    try { sent = await sender({ subject: record.emailSubject, bodySnapshot: record.emailBodySnapshot, sentTo: record.recipientEmails, escalationId: record.id }); }
    catch { sent = { success: false, providerMessageId: null, failureReason: "Email belum terkirim. Silakan kirim ulang." }; }
    const admin = adminUser();
    const updated = await database.transaction(async tx => {
      const [saved] = await tx.update(escalations).set({ deliveryStatus: sent.success ? "SENT" : "FAILED", providerMessageId: sent.providerMessageId, failureReason: sent.failureReason, updatedAt: new Date() }).where(eq(escalations.id, record.id)).returning();
      await appendAuditLog({ reportId: record.reportId, actorId: admin.id, actorType: "ADMIN", actionType: sent.success ? "ESCALATION_EMAIL_SENT" : "ESCALATION_EMAIL_FAILED", snapshotAfter: { escalationId: record.id, deliveryStatus: saved.deliveryStatus, agencyName }, rawIp }, tx);
      return saved;
    });
    return resultFor(updated, agencyName);
  };

  const forward = async (input: ForwardInput) => {
    const admin = adminUser();
    const rep = await findReportByIdOrCode(input.reportIdOrCode, database);
    if (!rep) throw new AuthError(404, "REPORT_NOT_FOUND", "Laporan tidak ditemukan.");
    // Commit assignment and the queued message before contacting the email provider.
    const assignment = await database.transaction(async tx => {
      const [current] = await tx.select().from(reports).where(eq(reports.id, rep.id)).for("update");
      const [agency] = await tx.select().from(agencies).where(and(eq(agencies.code, input.agencyCode), eq(agencies.isActive, true))).limit(1);
      if (!agency) throw new Error("Instansi tujuan tidak tersedia. Pilih instansi aktif.");
      if (current.status === "DITERUSKAN" && current.assignedAgencyId === agency.id) {
        const [existing] = await tx.select().from(escalations).where(and(eq(escalations.reportId, rep.id), eq(escalations.agencyId, agency.id))).orderBy(desc(escalations.sentAt)).limit(1);
        if (existing) return { record: existing, agencyName: agency.name, created: false };
      }
      if (!["TERVERIFIKASI", "DIBUKA_KEMBALI"].includes(current.status)) throw new AuthError(409, "INVALID_REPORT_STATUS", "Laporan harus terverifikasi atau dibuka kembali sebelum diteruskan.");
      const [draft] = await tx.select().from(reportDrafts).where(eq(reportDrafts.reportId, rep.id)).orderBy(desc(reportDrafts.createdAt)).limit(1);
      const [fact] = await tx.select().from(reportFactVersions).where(eq(reportFactVersions.reportId, rep.id)).orderBy(desc(reportFactVersions.versionNo)).limit(1);
      const message = buildOfficialEscalationMessage({ ticketCode: current.ticketCode, agencyName: agency.name, recipientEmails: agency.officialEmails, permanentLabel: "", title: draft?.title || `Laporan ${current.ticketCode}`, body: draft?.body || fact?.freeText || "", description: fact ? buildReportDescription(fact) : undefined, districtName: current.districtName || "Kota Bogor", landmark: fact?.landmark || "Kota Bogor", lat: current.lat, lng: current.lng, adminNote: input.adminNoteText });
      const [record] = await tx.insert(escalations).values({ reportId: rep.id, agencyId: agency.id, sentByUserId: admin.id, recipientEmails: message.sentTo, emailSubject: message.subject, emailBodySnapshot: message.bodySnapshot, deliveryStatus: "QUEUED" }).returning();
      await tx.update(reports).set({ status: "DITERUSKAN", assignedAgencyId: agency.id, forwardedAt: new Date(), returnedByAgency: false, updatedAt: new Date() }).where(eq(reports.id, rep.id));
      await appendAuditLog({ reportId: rep.id, actorId: admin.id, actorType: "ADMIN", actionType: "ROUTE_ASSIGNED", snapshotBefore: { status: current.status, assignedAgencyId: current.assignedAgencyId }, snapshotAfter: { status: "DITERUSKAN", agencyCode: agency.code, escalationId: record.id, deliveryStatus: "QUEUED" }, rawIp: input.rawIp }, tx);
      return { record, agencyName: agency.name, created: true };
    });
    if (!assignment.created) return resultFor(assignment.record, assignment.agencyName);
    try { return await deliver(assignment.record, assignment.agencyName, input.rawIp); }
    catch { return { ...resultFor(assignment.record, assignment.agencyName), failureReason: "Penugasan tersimpan. Status email belum dapat dipastikan; segarkan antrean." }; }
  };

  const verifyAndForward = async (input: ForwardInput) => {
    const admin = adminUser();
    const rep = await findReportByIdOrCode(input.reportIdOrCode, database);
    if (!rep) throw new AuthError(404, "REPORT_NOT_FOUND", "Laporan tidak ditemukan.");
    // Verification intentionally commits independently: an assignment failure preserves it.
    await database.transaction(async tx => {
      const [current] = await tx.select().from(reports).where(eq(reports.id, rep.id)).for("update");
      if (current.status === "MENUNGGU_VERIFIKASI") {
        if (input.adminNoteText?.trim()) await tx.insert(adminNotes).values({ reportId: rep.id, authorId: admin.id, note: input.adminNoteText.trim() });
        await tx.update(reports).set({ status: "TERVERIFIKASI", verifiedAt: new Date(), returnedByAgency: false, updatedAt: new Date() }).where(eq(reports.id, rep.id));
        await appendAuditLog({ reportId: rep.id, actorId: admin.id, actorType: "ADMIN", actionType: "VERIFY_REPORT", snapshotBefore: { status: current.status }, snapshotAfter: { status: "TERVERIFIKASI", adminNote: input.adminNoteText || null }, rawIp: input.rawIp }, tx);
      } else if (!["TERVERIFIKASI", "DITERUSKAN"].includes(current.status)) throw new AuthError(409, "INVALID_REPORT_STATUS", "Status laporan sudah berubah. Segarkan antrean.");
    });
    try { return { ...await forward(input), assignmentFailed: false }; }
    catch (err) {
      const current = await findReportByIdOrCode(rep.id, database);
      return { status: current?.status || "TERVERIFIKASI", assignmentFailed: true, assignmentError: err instanceof Error ? err.message : "Penugasan gagal. Coba teruskan kembali tanpa verifikasi ulang." };
    }
  };

  const retryEmail = async (reportIdOrCode: string, escalationId: string, rawIp?: string) => {
    adminUser();
    const rep = await findReportByIdOrCode(reportIdOrCode, database);
    if (!rep) throw new Error("Laporan tidak ditemukan.");
    const claim = await database.transaction(async tx => {
      const [current] = await tx.select().from(reports).where(eq(reports.id, rep.id)).for("update");
      const [record] = await tx.select().from(escalations).where(and(eq(escalations.id, escalationId), eq(escalations.reportId, rep.id))).for("update");
      if (!record || current.assignedAgencyId !== record.agencyId || current.returnedByAgency) throw new Error("Penugasan sudah berubah. Segarkan antrean.");
      if (["SENT", "DELIVERED"].includes(record.deliveryStatus)) return { record, send: false };
      if (record.deliveryStatus === "QUEUED" && Date.now() - record.updatedAt.getTime() < LEASE_MS) throw new Error("Email sedang diproses. Tunggu sebentar lalu segarkan antrean.");
      const [agency] = await tx.select().from(agencies).where(and(eq(agencies.id, record.agencyId), eq(agencies.isActive, true))).limit(1);
      if (!agency) throw new Error("Instansi tidak aktif.");
      const [queued] = await tx.update(escalations).set({ deliveryStatus: "QUEUED", recipientEmails: agency.officialEmails, failureReason: null, updatedAt: new Date() }).where(eq(escalations.id, record.id)).returning();
      return { record: queued, send: true, agencyName: agency.name };
    });
    if (!claim.send) return resultFor(claim.record, "Instansi tujuan");
    return deliver(claim.record, claim.agencyName!, rawIp);
  };
  return { forward, verifyAndForward, retryEmail };
}

export const adminForwarding = createAdminForwardingService();
