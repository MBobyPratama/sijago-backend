import { CONDITION_TAG_LABELS, presentConditionTags } from "../utils/conditionTags.js";
import { parsePublicAdminResponse } from "../utils/publicReport.js";
import { buildReportDescription } from "../utils/reportDescription.js";
import { AuthError } from "./auth.service.js";
import { authContext } from "../auth-context.js";
import { eq, desc, and, ne, sql, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  reports,
  reportDrafts,
  reportFactVersions,
  reportPhotos,
  reportUpvotes,
  reportConditionTags,
  signoffs,
  agencies,
  users,
  adminNotes,
  escalations,
  agencyUpdates,
  systemConfig,
} from "../db/schema.js";
import { hashWithSalt } from "../utils/hash.js";
import { appendAuditLog } from "./audit.service.js";
import { buildStrippedPublicImageUrl } from "./cloudinary.service.js";


/**
 * Mengambil admin dari sesi terautentikasi untuk pencatatan moderasi & eskalasi.
 */
export async function getAuthenticatedAdminUser() {
  const admin = authContext.getStore();
  if (!admin || !["ADMIN", "SUPER_ADMIN"].includes(admin.role)) throw new Error("Sesi admin tidak valid. Silakan masuk kembali.");
  return admin;
}

/**
 * Membentuk objek laporan lengkap (beserta draf, fakta asal, tag kondisi, sign-off, foto, dan instansi)
 * baik untuk Peta Publik (F4), Moderasi Admin (F5), maupun Portal Instansi (F6).
 */
export async function listEnrichedReports(options?: {
  publicOnly?: boolean;
  district?: string;
  category?: string;
  agencyCode?: string;
  reportIds?: string[];
}, database: Pick<typeof db, "select"> = db) {
  if (options?.reportIds?.length === 0) return [];
  const allReports = await database
    .select()
    .from(reports)
    .where(and(
      ne(reports.status, "DRAFT"),
      options?.reportIds ? inArray(reports.id, options.reportIds) : undefined,
      options?.agencyCode && options.agencyCode !== "ALL"
        ? and(eq(reports.returnedByAgency, false), sql`${reports.assignedAgencyId} IN (SELECT ${agencies.id} FROM ${agencies} WHERE ${agencies.code} = ${options.agencyCode})`)
        : undefined,
    ))
    .orderBy(desc(reports.priorityScore), desc(reports.createdAt))
    .limit(options?.reportIds ? options.reportIds.length : 50);

  const allAgencies = await database.select().from(agencies);
  const agencyMap = new Map(allAgencies.map((a) => [a.id, a]));

  const escalationRows = await database.select({ id: escalations.id, reportId: escalations.reportId, agencyId: escalations.agencyId, deliveryStatus: escalations.deliveryStatus, failureReason: escalations.failureReason, updatedAt: escalations.updatedAt }).from(escalations).where(inArray(escalations.reportId, allReports.map(report => report.id))).orderBy(desc(escalations.sentAt));
  const forwardedReports = new Set(escalationRows.map(item => item.reportId));
  const results = [];

  for (const rep of allReports) {
    if (options?.publicOnly && ["MENUNGGU_VERIFIKASI", "DITOLAK", "DUPLIKAT"].includes(rep.status)) {
      continue;
    }
    if (options?.district && options.district !== "ALL" && rep.districtName !== options.district) {
      continue;
    }

    const [fact] = rep.currentFactsVersionId
      ? await database
          .select()
          .from(reportFactVersions)
          .where(eq(reportFactVersions.id, rep.currentFactsVersionId))
          .limit(1)
      : [];

    if (options?.category && options.category !== "ALL" && fact?.category !== options.category) {
      continue;
    }

    const agency = rep.assignedAgencyId ? agencyMap.get(rep.assignedAgencyId) ?? null : null;
    if (options?.agencyCode && options.agencyCode !== "ALL" && agency?.code !== options.agencyCode) {
      continue;
    }

    const [draft] = rep.approvedDraftId
      ? await database
          .select()
          .from(reportDrafts)
          .where(eq(reportDrafts.id, rep.approvedDraftId))
          .limit(1)
      : await database
          .select()
          .from(reportDrafts)
          .where(eq(reportDrafts.reportId, rep.id))
          .orderBy(desc(reportDrafts.createdAt))
          .limit(1);

    const tagsRows = await database
      .select({
        tagCode: reportConditionTags.tagCode,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(reportConditionTags)
      .where(eq(reportConditionTags.reportId, rep.id))
      .groupBy(reportConditionTags.tagCode);

    const signoffRows = await database
      .select()
      .from(signoffs)
      .where(eq(signoffs.reportId, rep.id));

    const photos = await database
      .select()
      .from(reportPhotos)
      .where(eq(reportPhotos.reportId, rep.id));

    const notes = await database
      .select()
      .from(adminNotes)
      .where(eq(adminNotes.reportId, rep.id))
      .orderBy(desc(adminNotes.createdAt));

    const mulusCount = signoffRows.filter((s) => s.rating === "MULUS").length;
    const cepatRusakCount = signoffRows.filter((s) => s.rating === "CEPAT_RUSAK").length;



    const dims = [
      fact?.sizeLengthCm != null ? `panjang ${fact.sizeLengthCm} cm` : null,
      fact?.sizeWidthCm != null ? `lebar ${fact.sizeWidthCm} cm` : null,
      fact?.sizeDepthCm != null ? `kedalaman ${fact.sizeDepthCm} cm` : null,
    ].filter(Boolean).join(", ");

    const latestEscalation = escalationRows.find(item => item.reportId === rep.id && item.agencyId === rep.assignedAgencyId);
    results.push({
      id: rep.id,
      ticketCode: rep.ticketCode,
      trackingToken: rep.trackingToken,
      title: draft?.title ?? `[${fact?.category ?? "LUBANG"}] Laporan Kerusakan Jalan`,
      body: draft?.body ?? fact?.freeText ?? "",
      description: fact ? buildReportDescription(fact) : null,
      draftSource: draft?.sourceType ?? "AI",
      permanentLabel:
        draft?.sourceType === "TEMPLATE" ? "📄 [Draf Template]" : "✨ [Draf Dibantu AI]",
      status: rep.status,
      category: fact?.category ?? "LUBANG",
      sizeClass: fact?.sizeClass ?? "SEDANG",
      dimensionsCm: dims || (fact?.sizeClass ? `Kelas ${fact.sizeClass.toLowerCase()} (perkiraan warga)` : "Ukuran belum tersedia"),
      districtName: rep.districtName ?? "Bogor Tengah",
      subdistrictName: rep.subdistrictName ?? "Paledang",
      landmark: fact?.landmark ?? rep.suggestedStreetName ?? "Kota Bogor",
      suggestedStreetName: rep.suggestedStreetName ?? "Kota Bogor",
      lat: Number(rep.lat),
      lng: Number(rep.lng),
      gpsAccuracyMeters: fact?.gpsAccuracyM == null ? null : Number(fact.gpsAccuracyM),
      locationSource: rep.locationSource,
      exifDistanceMeters: photos[0]?.exifDistanceMeters == null ? null : Number(photos[0].exifDistanceMeters),
      exifMismatchFlag: Boolean(photos[0]?.exifMismatchFlag),
      upvotes: rep.upvoteCount,
      priorityScore: Number(rep.priorityScore),
      assignedAgency: agency?.name ?? null,
      assignedAgencyCode: agency?.code ?? null,
      canCancelVerification: rep.status === "TERVERIFIKASI" && !rep.assignedAgencyId && !rep.forwardedAt && !forwardedReports.has(rep.id),
      returnedByAgency: rep.returnedByAgency,
      returnReason: rep.returnReason,
      isRecurrentHotspot: rep.isRecurrentHotspot,
      createdAt: rep.createdAt.toLocaleString("id-ID"),
      createdAtIso: rep.createdAt.toISOString(),
      submittedAt: rep.submittedAt?.toISOString() ?? null,
      observedAt: fact?.observedAt?.toISOString() ?? null,
      freeText: fact?.freeText ?? null,
      impactTags: fact?.impactTags ?? [],
      conditionTags: presentConditionTags(tagsRows),
      signoffSummary: {
        monitoringDaysLeft: rep.monitoringEndsAt ? Math.max(0, Math.ceil((rep.monitoringEndsAt.getTime() - Date.now()) / 86400000)) : 0,
        mulusCount,
        cepatRusakCount,
      },
      photos: photos.map((p) => ({
        id: p.id,
        kind: p.kind,
        publicUrl: p.publicUrl,
        isBlurredByAdmin: p.isBlurredByAdmin,
      })),
      adminNotes: notes.map((n) => n.note),
      publicAdminResponse: rep.publicAdminResponse,
      escalationEmail: latestEscalation ? { id: latestEscalation.id, deliveryStatus: latestEscalation.deliveryStatus, failureReason: latestEscalation.failureReason, canRetry: !rep.returnedByAgency && (["FAILED", "BOUNCED"].includes(latestEscalation.deliveryStatus) || latestEscalation.deliveryStatus === "QUEUED" && Date.now() - latestEscalation.updatedAt.getTime() >= 120000) } : null,
    });
  }

  return results;
}

/**
 * Mencari satu laporan berdasarkan ID UUID atau Ticket Code (`SJG-2026-XXXX`).
 */
export async function findReportByIdOrCode(idOrCode: string, executor: Pick<typeof db, "select"> = db) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    idOrCode
  );
  const [rep] = await executor
    .select()
    .from(reports)
    .where(isUuid ? eq(reports.id, idOrCode) : eq(reports.ticketCode, idOrCode.toUpperCase()))
    .limit(1);
  return rep ?? null;
}

/**
 * POST /v1/public/reports/:id/upvote — Toggle dukungan "+1 Saya Lewat Sini" (FR-4.4, US-08).
 */
export async function toggleReportUpvote(reportIdOrCode: string, deviceId: string) {
  const rep = await findReportByIdOrCode(reportIdOrCode);
  if (!rep) throw new Error("REPORT_NOT_FOUND");

  const voterKey = `voter_${hashWithSalt(deviceId).slice(0, 16)}`;

  const existing = await db
    .select()
    .from(reportUpvotes)
    .where(and(eq(reportUpvotes.reportId, rep.id), eq(reportUpvotes.voterKey, voterKey)))
    .limit(1);

  let upvoted: boolean;
  let newCount = rep.upvoteCount;

  if (existing[0]) {
    await db.delete(reportUpvotes).where(eq(reportUpvotes.id, existing[0].id));
    newCount = Math.max(0, rep.upvoteCount - 1);
    upvoted = false;
  } else {
    await db.insert(reportUpvotes).values({
      reportId: rep.id,
      voterKey,
    });
    newCount = rep.upvoteCount + 1;
    upvoted = true;
  }

  // Hitung ulang skor prioritas sederhana (FR-4.5)
  const newPriority = Math.min(99.9, Number(rep.priorityScore) + (upvoted ? 1.5 : -1.5));

  await db
    .update(reports)
    .set({
      upvoteCount: newCount,
      priorityScore: newPriority.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(reports.id, rep.id));

  return {
    reportId: rep.id,
    ticketCode: rep.ticketCode,
    upvoted,
    upvoteCount: newCount,
    priorityScore: newPriority,
  };
}

/**
 * POST /v1/public/reports/:id/tags — Menambahkan Tag Kondisi setelah OTP Email terverifikasi (FR-4.6, US-09).
 */
export async function addReportConditionTag(params: {
  reportIdOrCode: string;
  tagCode: string;
  deviceId: string;
  verifiedEmailHash: string;
}, executor: Pick<typeof db, "select" | "insert"> = db) {
  if (!CONDITION_TAG_LABELS[params.tagCode]) throw new Error("Tag kondisi tidak valid.");
  const rep = await findReportByIdOrCode(params.reportIdOrCode, executor);
  if (!rep) throw new Error("REPORT_NOT_FOUND");

  const voterKey = `verified_${params.verifiedEmailHash}`;

  await executor
    .insert(reportConditionTags)
    .values({
      reportId: rep.id,
      tagCode: params.tagCode,
      voterKey,
      verifiedEmailHash: params.verifiedEmailHash,
    })
    .onConflictDoNothing();

  const tagRows = await executor.select({ tagCode: reportConditionTags.tagCode, count: sql<number>`COUNT(*)::int` }).from(reportConditionTags).where(eq(reportConditionTags.reportId, rep.id)).groupBy(reportConditionTags.tagCode);
  return { reportId: rep.id, tagCode: params.tagCode, conditionTags: presentConditionTags(tagRows) };
}

/**
 * POST /v1/public/reports/:id/signoff — Menyimpan rating Community Sign-Off ("MULUS" / "CEPAT_RUSAK").
 * Menegakkan FR-10.5: Jika suara Cepat Rusak >= min_votes (default 3) dan > 50%, otomatis ubah status
 * menjadi `DIBUKA_KEMBALI` dan catat audit log `REOPENED`.
 */
export async function submitCommunitySignoff(params: {
  reportIdOrCode: string;
  rating: "MULUS" | "CEPAT_RUSAK";
  comment?: string;
  deviceId: string;
  rawIp?: string;
  verifiedEmailHash: string;
}, database: Pick<typeof db, "select" | "transaction"> = db) {
  if (!["MULUS", "CEPAT_RUSAK"].includes(params.rating)) throw new Error("Penilaian tidak valid.");
  if (params.comment != null && (typeof params.comment !== "string" || params.comment.length > 500)) throw new Error("Komentar maksimal 500 karakter.");
  const report = await findReportByIdOrCode(params.reportIdOrCode, database);
  if (!report) throw new Error("REPORT_NOT_FOUND");
  return database.transaction(async tx => {
    const [rep] = await tx.select().from(reports).where(eq(reports.id, report.id)).for("update");
    if (!rep) throw new Error("REPORT_NOT_FOUND");
    if (!["SELESAI", "DIBUKA_KEMBALI"].includes(rep.status) || !rep.monitoringEndsAt || rep.monitoringEndsAt.getTime() <= Date.now()) throw new Error("Penilaian hanya tersedia selama masa pemantauan hasil perbaikan.");

    const voterKey = `verified_${params.verifiedEmailHash}`;

    await tx.insert(signoffs).values({
      reportId: rep.id,
      voterKey,
      rating: params.rating,
      comment: params.comment ?? null,
    }).onConflictDoUpdate({ target: [signoffs.reportId, signoffs.voterKey], set: { rating: params.rating, comment: params.comment?.trim() || null, updatedAt: new Date() } });

    await appendAuditLog({
      reportId: rep.id,
      actorId: voterKey,
      actorType: "WARGA_PSEUDONIM",
      actionType: "SIGNOFF_SUBMITTED",
      snapshotBefore: { status: rep.status },
      snapshotAfter: { rating: params.rating, comment: params.comment ?? null },
      rawIp: params.rawIp,
    }, tx);

    const allVotes = await tx.select().from(signoffs).where(eq(signoffs.reportId, rep.id));
    const mulusCount = allVotes.filter((v) => v.rating === "MULUS").length;
    const cepatRusakCount = allVotes.filter((v) => v.rating === "CEPAT_RUSAK").length;
    const totalVotes = mulusCount + cepatRusakCount;

    const config = await tx.select().from(systemConfig);
    const configuredMin = Number(config.find(item => item.key === "signoff_reopen_min_votes")?.value ?? 3);
    const configuredRatio = Number(config.find(item => item.key === "signoff_reopen_bad_ratio")?.value ?? 0.5);
    const minVotes = Number.isInteger(configuredMin) && configuredMin > 0 ? configuredMin : 3;
    const ratio = configuredRatio > 0 && configuredRatio <= 1 ? configuredRatio : 0.5;
    const reopenedTriggered =
      params.rating === "CEPAT_RUSAK" &&
      cepatRusakCount >= minVotes && totalVotes > 0 && cepatRusakCount / totalVotes > ratio;

    if (reopenedTriggered && rep.status !== "DIBUKA_KEMBALI") {
      await tx
        .update(reports)
        .set({
          status: "DIBUKA_KEMBALI",
          reopenedAt: new Date(),
          isRecurrentHotspot: true,
          updatedAt: new Date(),
        })
        .where(eq(reports.id, rep.id));

      await appendAuditLog({
        reportId: rep.id,
        actorId: "system_signoff_threshold",
        actorType: "SISTEM",
        actionType: "REOPENED",
        snapshotBefore: { status: rep.status },
        snapshotAfter: {
          status: "DIBUKA_KEMBALI",
          mulusCount,
          cepatRusakCount,
        },
        rawIp: params.rawIp,
      }, tx);
    }

    return {
      reportId: rep.id,
      ticketCode: rep.ticketCode,
      mulusCount,
      cepatRusakCount,
      reopenedTriggered,
      newStatus: reopenedTriggered ? "DIBUKA_KEMBALI" : rep.status,
    };
  });
}

/**
 * POST /v1/admin/reports/:id/verify — Admin memverifikasi laporan (FR-5.4, US-11).
 */
export async function adminVerifyReport(
  reportIdOrCode: string,
  adminNoteText?: string,
  rawIp?: string
) {
  const rep = await findReportByIdOrCode(reportIdOrCode);
  if (!rep) throw new Error("REPORT_NOT_FOUND");
  const adminUser = await getAuthenticatedAdminUser();
  return db.transaction(async tx => {
    const [current] = await tx.select().from(reports).where(eq(reports.id, rep.id)).for("update");
    if (current?.status !== "MENUNGGU_VERIFIKASI") throw new AuthError(409, "INVALID_REPORT_STATUS", "Hanya laporan menunggu verifikasi yang dapat diverifikasi.");

    if (adminNoteText && adminNoteText.trim()) {
      await tx.insert(adminNotes).values({
        reportId: rep.id,
        authorId: adminUser.id,
        note: adminNoteText.trim(),
      });
    }

    await tx
      .update(reports)
      .set({
        status: "TERVERIFIKASI",
        verifiedAt: new Date(),
        returnedByAgency: false,
        updatedAt: new Date(),
      })
      .where(eq(reports.id, rep.id));

    await appendAuditLog({
      reportId: rep.id,
      actorId: adminUser.email,
      actorType: "ADMIN",
      actionType: "VERIFY_REPORT",
      snapshotBefore: { status: rep.status },
      snapshotAfter: { status: "TERVERIFIKASI", adminNote: adminNoteText ?? null },
      rawIp,
    }, tx);

    return { reportId: rep.id, ticketCode: rep.ticketCode, status: "TERVERIFIKASI" };
  });
}

/** Cancel verification atomically, preserving source facts and audit history. */
export async function savePublicAdminResponse(reportIdOrCode: string, value: unknown, rawIp?: string) {
  const response = parsePublicAdminResponse(value);
  const rep = await findReportByIdOrCode(reportIdOrCode);
  if (!rep) throw new Error("REPORT_NOT_FOUND");
  const admin = await getAuthenticatedAdminUser();
  return db.transaction(async tx => {
    const [current] = await tx.select().from(reports).where(eq(reports.id, rep.id)).for("update");
    await tx.update(reports).set({ publicAdminResponse: response, updatedAt: new Date() }).where(eq(reports.id, rep.id));
    await appendAuditLog({ reportId: rep.id, actorId: admin.id, actorType: "ADMIN", actionType: "ADMIN_OVERRIDE", snapshotBefore: { publicAdminResponse: current.publicAdminResponse }, snapshotAfter: { publicAdminResponse: response, operation: "PUBLIC_ADMIN_RESPONSE_UPDATED" }, rawIp }, tx);
    return { publicAdminResponse: response };
  });
}

export async function adminCancelVerification(reportIdOrCode: string, reason: unknown, rawIp?: string) {
  if (typeof reason !== "string" || !reason.trim() || reason.trim().length > 2000) throw new AuthError(400, "INVALID_REASON", "Isi alasan pembatalan, maksimal 2.000 karakter.");
  const admin = await getAuthenticatedAdminUser();
  const report = await findReportByIdOrCode(reportIdOrCode);
  if (!report) throw new AuthError(404, "REPORT_NOT_FOUND", "Laporan tidak ditemukan.");
  return db.transaction(async tx => {
    const [current] = await tx.select().from(reports).where(eq(reports.id, report.id)).for("update");
    const [sent] = await tx.select({ id: escalations.id }).from(escalations).where(eq(escalations.reportId, report.id)).limit(1);
    if (!current || current.status !== "TERVERIFIKASI" || current.assignedAgencyId || current.forwardedAt || sent) throw new AuthError(409, "CANNOT_CANCEL_VERIFICATION", "Verifikasi hanya dapat dibatalkan sebelum laporan diteruskan ke instansi. Segarkan antrean untuk melihat status terbaru.");
    await tx.update(reports).set({ status: "MENUNGGU_VERIFIKASI", verifiedAt: null, updatedAt: new Date() }).where(eq(reports.id, report.id));
    await tx.insert(adminNotes).values({ reportId: report.id, authorId: admin.id, note: `Pembatalan verifikasi: ${reason.trim()}` });
    await appendAuditLog({ reportId: report.id, actorId: admin.id, actorType: "ADMIN", actionType: "STATUS_CHANGED", snapshotBefore: { status: current.status, verifiedAt: current.verifiedAt }, snapshotAfter: { status: "MENUNGGU_VERIFIKASI", verifiedAt: null, action: "CANCEL_VERIFICATION", reason: reason.trim() }, rawIp }, tx);
    return { reportId: report.id, ticketCode: report.ticketCode, status: "MENUNGGU_VERIFIKASI" };
  });
}

/**
 * POST /v1/admin/reports/:id/reject — Admin menolak laporan dengan alasan wajib (FR-5.4, US-11).
 */
export async function adminRejectReport(
  reportIdOrCode: string,
  reason: string,
  note?: string,
  rawIp?: string
) {
  const rep = await findReportByIdOrCode(reportIdOrCode);
  if (!rep) throw new Error("REPORT_NOT_FOUND");
  const adminUser = await getAuthenticatedAdminUser();

  await db
    .update(reports)
    .set({
      status: "DITOLAK",
      rejectionReason: reason,
      rejectionNote: note ?? null,
      updatedAt: new Date(),
    })
    .where(eq(reports.id, rep.id));

  await appendAuditLog({
    reportId: rep.id,
    actorId: adminUser.email,
    actorType: "ADMIN",
    actionType: "REJECT_REPORT",
    snapshotBefore: { status: rep.status },
    snapshotAfter: { status: "DITOLAK", rejectionReason: reason },
    rawIp,
  });

  return { reportId: rep.id, ticketCode: rep.ticketCode, status: "DITOLAK" };
}

/**
 * POST /v1/admin/reports/:id/merge — Admin menggabungkan laporan duplikat ke laporan induk (FR-4.7, US-12).
 */
export async function adminMergeDuplicateReport(
  duplicateIdOrCode: string,
  parentIdOrCode: string,
  rawIp?: string,
  database: Pick<typeof db, "select" | "transaction"> = db,
) {
  const adminUser = await getAuthenticatedAdminUser();
  const duplicate = await findReportByIdOrCode(duplicateIdOrCode, database);
  const master = await findReportByIdOrCode(parentIdOrCode, database);
  if (!duplicate || !master) throw new Error("REPORT_NOT_FOUND");
  if (duplicate.id === master.id) throw new Error("Laporan induk harus berbeda dari laporan yang digabung.");

  return database.transaction(async tx => {
    // Consistent lock order prevents two opposing merges from creating a cycle.
    const locked = await tx.select().from(reports).where(inArray(reports.id, [duplicate.id, master.id])).orderBy(reports.id).for("update");
    const dup = locked.find(item => item.id === duplicate.id)!;
    const parent = locked.find(item => item.id === master.id)!;
    if (["DRAFT", "DUPLIKAT", "DITOLAK"].includes(parent.status) || parent.duplicateOfId) throw new Error("Laporan induk tidak lagi tersedia untuk penggabungan.");
    if (dup.status === "DUPLIKAT" && dup.duplicateOfId === parent.id) return { duplicateTicket: dup.ticketCode, parentTicket: parent.ticketCode, newParentUpvotes: parent.upvoteCount };
    if (dup.duplicateOfId || ["DRAFT", "DUPLIKAT", "DITOLAK"].includes(dup.status)) throw new Error("Laporan ini tidak dapat digabungkan.");
    // Do not create a chain that leaves existing duplicates pointing at an inactive parent.
    const children = await tx.select({id:reports.id}).from(reports).where(eq(reports.duplicateOfId, dup.id)).limit(1);
    if (children.length) throw new Error("Laporan ini sudah menjadi induk. Pilih laporan ini sebagai induk penggabungan.");

    const votes = await tx.select().from(reportUpvotes).where(eq(reportUpvotes.reportId, dup.id));
    if (votes.length) await tx.insert(reportUpvotes).values(votes.map(vote => ({reportId:parent.id, voterKey:vote.voterKey, createdAt:vote.createdAt}))).onConflictDoNothing();
    const tags = await tx.select().from(reportConditionTags).where(eq(reportConditionTags.reportId, dup.id));
    if (tags.length) await tx.insert(reportConditionTags).values(tags.map(tag => ({reportId:parent.id, tagCode:tag.tagCode, voterKey:tag.voterKey, verifiedEmailHash:tag.verifiedEmailHash, createdAt:tag.createdAt}))).onConflictDoNothing();
    const [count] = await tx.select({total:sql<number>`count(*)::int`}).from(reportUpvotes).where(eq(reportUpvotes.reportId, parent.id));
    const mergedUpvotes = count.total;
    await tx.update(reports).set({status:"DUPLIKAT", duplicateOfId:parent.id, updatedAt:new Date()}).where(eq(reports.id,dup.id));
    await tx.update(reports).set({upvoteCount:mergedUpvotes, updatedAt:new Date()}).where(eq(reports.id,parent.id));
    await appendAuditLog({reportId:dup.id,actorId:adminUser.email,actorType:"ADMIN",actionType:"DUPLICATE_MERGED",snapshotBefore:{status:dup.status,parentUpvotes:parent.upvoteCount},snapshotAfter:{status:"DUPLIKAT",mergedIntoTicket:parent.ticketCode,newParentUpvotes:mergedUpvotes,sourceVoteRecords:votes.length,sourceTagRecords:tags.length},rawIp},tx);
    return {duplicateTicket:dup.ticketCode,parentTicket:parent.ticketCode,newParentUpvotes:mergedUpvotes};
  });
}

/**
 * POST /v1/admin/reports/:id/blur-photo — Admin memburamkan wajah/pelat nomor pada foto publik (FR-5.12).
 */
export async function adminToggleBlurReportPhoto(
  reportIdOrCode: string,
  blur: boolean,
  rawIp?: string
) {
  const rep = await findReportByIdOrCode(reportIdOrCode);
  if (!rep) throw new Error("REPORT_NOT_FOUND");

  const photos = await db
    .select()
    .from(reportPhotos)
    .where(eq(reportPhotos.reportId, rep.id));

  for (const p of photos) {
    const updatedUrl = buildStrippedPublicImageUrl(
      p.cloudinaryPublicId,
      p.originalSecureUrl,
      blur
    );
    await db
      .update(reportPhotos)
      .set({ isBlurredByAdmin: blur, publicUrl: updatedUrl })
      .where(eq(reportPhotos.id, p.id));
  }

  return { reportId: rep.id, ticketCode: rep.ticketCode, isBlurredByAdmin: blur };
}

/**
 * POST /v1/agency/reports/:id/status — Petugas Instansi memperbarui status ke DIPROSES atau SELESAI (FR-6.3, FR-6.4).
 */
export async function agencyUpdateReportStatus(params: {
  reportIdOrCode: string;
  agencyCode: string;
  newStatus: "DIPROSES" | "SELESAI";
  plannedDate?: string;
  note?: string;
  afterPhotoUploaded?: boolean;
  rawIp?: string;
}) {
  const rep = await findReportByIdOrCode(params.reportIdOrCode);
  if (!rep) throw new Error("REPORT_NOT_FOUND");

  if (params.newStatus === "SELESAI" && params.afterPhotoUploaded === false) {
    throw new Error("AFTER_PHOTO_REQUIRED_FOR_SELESAI");
  }

  const [agency] = await db
    .select()
    .from(agencies)
    .where(eq(agencies.code, params.agencyCode))
    .limit(1);

  if (!agency || rep.assignedAgencyId !== agency.id) throw new Error("Laporan bukan kewenangan instansi ini.");
  const targetAgency = agency;
  const afterPhotos = await db.select({ id: reportPhotos.id }).from(reportPhotos).where(and(eq(reportPhotos.reportId, rep.id), eq(reportPhotos.kind, "AFTER")));
  if (params.newStatus === "SELESAI" && afterPhotos.length === 0) throw new Error("Foto bukti sesudah perbaikan wajib diunggah.");

  await db.insert(agencyUpdates).values({
    reportId: rep.id,
    agencyId: targetAgency.id,
    newStatus: params.newStatus,
    plannedDate: params.plannedDate ?? null,
    note: params.note ?? null,
    afterPhotoIds: params.newStatus === "SELESAI" ? afterPhotos.map(photo => photo.id) : [],
    isAdminOverride: false,
  });

  const now = new Date();
  const [monitoringConfig] = await db.select().from(systemConfig).where(eq(systemConfig.key, "signoff_monitoring_days")).limit(1);
  const configuredDays = Number(monitoringConfig?.value ?? 30);
  const monitoringDays = Number.isInteger(configuredDays) && configuredDays > 0 ? configuredDays : 30;
  const monitoringEnds = new Date(now.getTime() + monitoringDays * 24 * 60 * 60 * 1000);

  await db
    .update(reports)
    .set({
      status: params.newStatus,
      inProgressAt: params.newStatus === "DIPROSES" ? now : rep.inProgressAt,
      resolvedAt: params.newStatus === "SELESAI" ? now : rep.resolvedAt,
      monitoringEndsAt: params.newStatus === "SELESAI" ? monitoringEnds : rep.monitoringEndsAt,
      updatedAt: now,
    })
    .where(eq(reports.id, rep.id));

  await appendAuditLog({
    reportId: rep.id,
    actorId: authContext.getStore()?.id || `petugas:${targetAgency.code}`,
    actorType: "INSTANSI",
    actionType: "STATUS_CHANGED",
    snapshotBefore: { status: rep.status },
    snapshotAfter: {
      status: params.newStatus,
      agencyName: targetAgency.name,
      note: params.note ?? null,
    },
    rawIp: params.rawIp,
  });

  return {
    reportId: rep.id,
    ticketCode: rep.ticketCode,
    status: params.newStatus,
    agencyName: targetAgency.name,
  };
}

/**
 * POST /v1/agency/reports/:id/return — Instansi mengembalikan laporan yang bukan kewenangannya ke Admin (FR-6.6 / US-14).
 */
export async function agencyReturnReportToAdmin(params: {
  reportIdOrCode: string;
  agencyCode: string;
  reason: string;
  rawIp?: string;
}, database: Pick<typeof db, "select" | "update" | "insert"> = db) {
  const rep = await findReportByIdOrCode(params.reportIdOrCode, database);
  if (!rep) throw new Error("REPORT_NOT_FOUND");

  await database
    .update(reports)
    .set({
      status: "TERVERIFIKASI",
      assignedAgencyId: null,
      forwardedAt: null,
      returnedByAgency: true,
      returnReason: params.reason,
      updatedAt: new Date(),
    })
    .where(eq(reports.id, rep.id));

  await appendAuditLog({
    reportId: rep.id,
    actorId: authContext.getStore()?.id || `petugas:${params.agencyCode}`,
    actorType: "INSTANSI",
    actionType: "STATUS_CHANGED",
    snapshotBefore: { status: rep.status, assignedAgencyId: rep.assignedAgencyId },
    snapshotAfter: {
      status: "TERVERIFIKASI",
      assignedAgencyId: null,
      returnedByAgency: true,
      returnReason: params.reason,
    },
    rawIp: params.rawIp,
  }, database);

  return {
    reportId: rep.id,
    ticketCode: rep.ticketCode,
    status: "TERVERIFIKASI",
    returnedByAgency: true,
    returnReason: params.reason,
  };
}

/**
 * GET & PUT /v1/admin/config — Membaca dan memperbarui parameter `system_config` (US-20 / BR-19).
 */
export async function getSystemConfigs() {
  return db.select().from(systemConfig);
}

export async function updateSystemConfigs(
  updates: Record<string, unknown>,
  rawIp?: string
) {
  const adminUser = await getAuthenticatedAdminUser();

  for (const [key, value] of Object.entries(updates)) {
    await db
      .insert(systemConfig)
      .values({
        key,
        value,
        description: `Updated parameter ${key}`,
        updatedBy: adminUser.id,
      })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: {
          value,
          updatedBy: adminUser.id,
          updatedAt: new Date(),
        },
      });
  }

  await appendAuditLog({
    reportId: null,
    actorId: adminUser.email,
    actorType: "ADMIN",
    actionType: "CONFIG_UPDATED",
    snapshotBefore: null,
    snapshotAfter: updates,
    rawIp,
  });

  return getSystemConfigs();
}
