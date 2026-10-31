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
import { sendOfficialEscalationEmail } from "./email.service.js";

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
}) {
  const allReports = await db
    .select()
    .from(reports)
    .where(ne(reports.status, "DRAFT"))
    .orderBy(desc(reports.priorityScore), desc(reports.createdAt))
    .limit(50);

  const allAgencies = await db.select().from(agencies);
  const agencyMap = new Map(allAgencies.map((a) => [a.id, a]));

  const forwardedReports = new Set((await db.select({ reportId: escalations.reportId }).from(escalations)).map(item => item.reportId));
  const results = [];

  for (const rep of allReports) {
    if (options?.publicOnly && ["MENUNGGU_VERIFIKASI", "DITOLAK", "DUPLIKAT"].includes(rep.status)) {
      continue;
    }
    if (options?.district && options.district !== "ALL" && rep.districtName !== options.district) {
      continue;
    }

    const [fact] = rep.currentFactsVersionId
      ? await db
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
      ? await db
          .select()
          .from(reportDrafts)
          .where(eq(reportDrafts.id, rep.approvedDraftId))
          .limit(1)
      : await db
          .select()
          .from(reportDrafts)
          .where(eq(reportDrafts.reportId, rep.id))
          .orderBy(desc(reportDrafts.createdAt))
          .limit(1);

    const tagsRows = await db
      .select({
        tagCode: reportConditionTags.tagCode,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(reportConditionTags)
      .where(eq(reportConditionTags.reportId, rep.id))
      .groupBy(reportConditionTags.tagCode);

    const signoffRows = await db
      .select()
      .from(signoffs)
      .where(eq(signoffs.reportId, rep.id));

    const photos = await db
      .select()
      .from(reportPhotos)
      .where(eq(reportPhotos.reportId, rep.id));

    const notes = await db
      .select()
      .from(adminNotes)
      .where(eq(adminNotes.reportId, rep.id))
      .orderBy(desc(adminNotes.createdAt));

    const mulusCount = signoffRows.filter((s) => s.rating === "MULUS").length;
    const cepatRusakCount = signoffRows.filter((s) => s.rating === "CEPAT_RUSAK").length;

    const TAG_LABELS: Record<string, string> = {
      TERTUTUP_GENANGAN_AIR: "🌊 Tertutup Genangan Air",
      RAWAN_PEMOTOR_JATUH: "⚠️ Rawan Pemotor Jatuh",
      MINIM_PENERANGAN: "🌑 Minim Penerangan Malam",
    };

    const dims = [
      fact?.sizeLengthCm != null ? `panjang ${fact.sizeLengthCm} cm` : null,
      fact?.sizeWidthCm != null ? `lebar ${fact.sizeWidthCm} cm` : null,
      fact?.sizeDepthCm != null ? `kedalaman ${fact.sizeDepthCm} cm` : null,
    ].filter(Boolean).join(", ");

    results.push({
      id: rep.id,
      ticketCode: rep.ticketCode,
      trackingToken: rep.trackingToken,
      title: draft?.title ?? `[${fact?.category ?? "LUBANG"}] Laporan Kerusakan Jalan`,
      body: draft?.body ?? fact?.freeText ?? "",
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
      conditionTags: tagsRows.map((t) => ({
        code: t.tagCode,
        label: TAG_LABELS[t.tagCode] ?? t.tagCode,
        count: Number(t.count),
      })),
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
    });
  }

  return results;
}

/**
 * Mencari satu laporan berdasarkan ID UUID atau Ticket Code (`SJG-2026-XXXX`).
 */
export async function findReportByIdOrCode(idOrCode: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    idOrCode
  );
  const [rep] = await db
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
}) {
  const rep = await findReportByIdOrCode(params.reportIdOrCode);
  if (!rep) throw new Error("REPORT_NOT_FOUND");

  const voterKey = `voter_${hashWithSalt(params.deviceId).slice(0, 16)}`;

  await db
    .insert(reportConditionTags)
    .values({
      reportId: rep.id,
      tagCode: params.tagCode,
      voterKey,
      verifiedEmailHash: params.verifiedEmailHash,
    })
    .onConflictDoNothing();

  return { reportId: rep.id, tagCode: params.tagCode };
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
}) {
  const rep = await findReportByIdOrCode(params.reportIdOrCode);
  if (!rep) throw new Error("REPORT_NOT_FOUND");

  const voterKey = `voter_${hashWithSalt(params.deviceId)}_${Date.now().toString().slice(-4)}`;

  await db.insert(signoffs).values({
    reportId: rep.id,
    voterKey,
    rating: params.rating,
    comment: params.comment ?? null,
  });

  await appendAuditLog({
    reportId: rep.id,
    actorId: voterKey,
    actorType: "WARGA_PSEUDONIM",
    actionType: "SIGNOFF_SUBMITTED",
    snapshotBefore: { status: rep.status },
    snapshotAfter: { rating: params.rating, comment: params.comment ?? null },
    rawIp: params.rawIp,
  });

  const allVotes = await db.select().from(signoffs).where(eq(signoffs.reportId, rep.id));
  const mulusCount = allVotes.filter((v) => v.rating === "MULUS").length;
  const cepatRusakCount = allVotes.filter((v) => v.rating === "CEPAT_RUSAK").length;
  const totalVotes = mulusCount + cepatRusakCount;

  const reopenedTriggered =
    params.rating === "CEPAT_RUSAK" &&
    (cepatRusakCount >= 3 || (totalVotes >= 1 && cepatRusakCount / totalVotes > 0.5));

  if (reopenedTriggered && rep.status !== "DIBUKA_KEMBALI") {
    await db
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
    });
  }

  return {
    reportId: rep.id,
    ticketCode: rep.ticketCode,
    mulusCount,
    cepatRusakCount,
    reopenedTriggered,
    newStatus: reopenedTriggered ? "DIBUKA_KEMBALI" : rep.status,
  };
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
  rawIp?: string
) {
  const dup = await findReportByIdOrCode(duplicateIdOrCode);
  const parent = await findReportByIdOrCode(parentIdOrCode);
  if (!dup || !parent) throw new Error("REPORT_NOT_FOUND");
  const adminUser = await getAuthenticatedAdminUser();

  const mergedUpvotes = parent.upvoteCount + dup.upvoteCount;

  await db
    .update(reports)
    .set({
      status: "DUPLIKAT",
      duplicateOfId: parent.id,
      updatedAt: new Date(),
    })
    .where(eq(reports.id, dup.id));

  await db
    .update(reports)
    .set({
      upvoteCount: mergedUpvotes,
      updatedAt: new Date(),
    })
    .where(eq(reports.id, parent.id));

  await appendAuditLog({
    reportId: dup.id,
    actorId: adminUser.email,
    actorType: "ADMIN",
    actionType: "DUPLICATE_MERGED",
    snapshotBefore: { status: dup.status, parentUpvotes: parent.upvoteCount },
    snapshotAfter: {
      status: "DUPLIKAT",
      mergedIntoTicket: parent.ticketCode,
      newParentUpvotes: mergedUpvotes,
    },
    rawIp,
  });

  return {
    duplicateTicket: dup.ticketCode,
    parentTicket: parent.ticketCode,
    newParentUpvotes: mergedUpvotes,
  };
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
 * POST /v1/admin/reports/:id/escalate — Admin memilih instansi & menekan konfirmasi kirim email resmi via Resend (FR-5.5 - FR-5.8).
 */
export async function adminEscalateReportToAgency(params: {
  reportIdOrCode: string;
  agencyCode: string;
  adminNoteText?: string;
  rawIp?: string;
}) {
  const rep = await findReportByIdOrCode(params.reportIdOrCode);
  if (!rep) throw new Error("REPORT_NOT_FOUND");

  return db.transaction(async tx => {
    const [current] = await tx.select().from(reports).where(eq(reports.id, rep.id)).for("update");
    if (!current || !["TERVERIFIKASI", "DIBUKA_KEMBALI"].includes(current.status)) throw new AuthError(409, "INVALID_REPORT_STATUS", "Laporan harus terverifikasi sebelum diteruskan ke instansi.");
    const [agency] = await tx
      .select()
      .from(agencies)
      .where(eq(agencies.code, params.agencyCode))
      .limit(1);

    if (!agency) throw new Error("AGENCY_NOT_FOUND");
    const adminUser = await getAuthenticatedAdminUser();

    const [draft] = await tx
      .select()
      .from(reportDrafts)
      .where(eq(reportDrafts.reportId, rep.id))
      .orderBy(desc(reportDrafts.createdAt))
      .limit(1);

    const [fact] = await tx
      .select()
      .from(reportFactVersions)
      .where(eq(reportFactVersions.reportId, rep.id))
      .orderBy(desc(reportFactVersions.versionNo))
      .limit(1);

    const permanentLabel =
      draft?.sourceType === "TEMPLATE" ? "📄 [Draf Template]" : "✨ [Draf Dibantu AI]";

    const emailResult = await sendOfficialEscalationEmail({
      ticketCode: rep.ticketCode,
      agencyName: agency.name,
      recipientEmails: agency.officialEmails,
      permanentLabel,
      title: draft?.title ?? `Laporan ${rep.ticketCode}`,
      body: draft?.body ?? fact?.freeText ?? "",
      districtName: rep.districtName ?? "Kota Bogor",
      landmark: fact?.landmark ?? "Kota Bogor",
      lat: rep.lat,
      lng: rep.lng,
      adminNote: params.adminNoteText,
    });

    const [escalationRecord] = await tx
      .insert(escalations)
      .values({
        reportId: rep.id,
        agencyId: agency.id,
        sentByUserId: adminUser.id,
        recipientEmails: emailResult.sentTo,
        emailSubject: emailResult.subject,
        emailBodySnapshot: emailResult.bodySnapshot,
        providerMessageId: emailResult.providerMessageId,
        deliveryStatus: emailResult.deliveryStatus,
        failureReason: emailResult.failureReason,
      })
      .returning();

    // Aturan FR-5.7 & FR-5.8: Status berubah ke DITERUSKAN jika pengiriman diterima (atau fallback simulasi)
    await tx
      .update(reports)
      .set({
        status: "DITERUSKAN",
        assignedAgencyId: agency.id,
        forwardedAt: new Date(),
        returnedByAgency: false,
        updatedAt: new Date(),
      })
      .where(eq(reports.id, rep.id));

    await appendAuditLog({
      reportId: rep.id,
      actorId: adminUser.email,
      actorType: "ADMIN",
      actionType: emailResult.success ? "ESCALATION_EMAIL_SENT" : "ESCALATION_EMAIL_FAILED",
      snapshotBefore: { status: rep.status, assignedAgencyId: rep.assignedAgencyId },
      snapshotAfter: {
        status: "DITERUSKAN",
        agencyCode: agency.code,
        agencyName: agency.name,
        sentTo: emailResult.sentTo,
        providerMessageId: emailResult.providerMessageId,
        deliveryStatus: emailResult.deliveryStatus,
      },
      rawIp: params.rawIp,
    }, tx);

    return {
      escalationId: escalationRecord.id,
      ticketCode: rep.ticketCode,
      agencyName: agency.name,
      sentTo: emailResult.sentTo,
      providerMessageId: emailResult.providerMessageId,
      deliveryStatus: emailResult.deliveryStatus,
      newStatus: "DITERUSKAN",
    };
  });
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
  const monitoringEnds = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

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
}) {
  const rep = await findReportByIdOrCode(params.reportIdOrCode);
  if (!rep) throw new Error("REPORT_NOT_FOUND");

  await db
    .update(reports)
    .set({
      status: "TERVERIFIKASI",
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
    snapshotBefore: { status: rep.status },
    snapshotAfter: {
      status: "TERVERIFIKASI",
      returnedByAgency: true,
      returnReason: params.reason,
    },
    rawIp: params.rawIp,
  });

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
