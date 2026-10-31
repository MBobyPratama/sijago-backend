import { eq, sql, desc, and, inArray, or, isNull } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "../db/index.js";
import {
  reports,
  reporters,
  reportFactVersions,
  reportDrafts,
  reportApprovals,
  reportPhotos,
  agencies,
} from "../db/schema.js";
import { computeFactsHash, hashWithSalt } from "../utils/hash.js";
import { generateReportDraft } from "./aiDraft.service.js";
import { appendAuditLog } from "./audit.service.js";

/**
 * Menentukan Kecamatan di Kota Bogor berdasarkan titik koordinat GPS terdekat.
 */
export function resolveBogorDistrict(lat: number, lng: number): {
  districtName: string;
  subdistrictName: string;
} {
  const centers = [
    { districtName: "Bogor Tengah", subdistrictName: "Paledang", lat: -6.5971, lng: 106.7985 },
    { districtName: "Tanah Sareal", subdistrictName: "Kedungbadak", lat: -6.5612, lng: 106.7815 },
    { districtName: "Bogor Utara", subdistrictName: "Tegal Gundil", lat: -6.5725, lng: 106.8165 },
    { districtName: "Bogor Selatan", subdistrictName: "Empang", lat: -6.6285, lng: 106.7995 },
    { districtName: "Bogor Timur", subdistrictName: "Sukasari", lat: -6.6152, lng: 106.8142 },
    { districtName: "Bogor Barat", subdistrictName: "Loji", lat: -6.5825, lng: 106.7595 },
  ];

  let best = centers[0];
  let bestDist = Infinity;

  for (const c of centers) {
    const d = (lat - c.lat) ** 2 + (lng - c.lng) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return { districtName: best.districtName, subdistrictName: best.subdistrictName };
}

/**
 * Mencari laporan aktif di dalam radius R meter (default 30m) menggunakan PostGIS `ST_DWithin` (FR-1.9).
 */
export async function findNearbyActiveReports(
  lat: number,
  lng: number,
  radiusMeters = 30
) {
  const pointWkt = `SRID=4326;POINT(${lng} ${lat})`;
  const rows = await db
    .select({
      id: reports.id,
      ticketCode: reports.ticketCode,
      status: reports.status,
      districtName: reports.districtName,
      upvoteCount: reports.upvoteCount,
      distanceMeters: sql<number>`ROUND(ST_Distance(location::geography, ST_GeogFromText(${pointWkt}))::numeric, 1)`,
    })
    .from(reports)
    .where(
      and(
        inArray(reports.status, ["TERVERIFIKASI", "DITERUSKAN", "DIPROSES", "SELESAI", "DIBUKA_KEMBALI"]),
        sql`ST_DWithin(location::geography, ST_GeogFromText(${pointWkt}), ${radiusMeters})`
      )
    )
    .orderBy(sql`ST_Distance(location::geography, ST_GeogFromText(${pointWkt}))`, reports.id)
    .limit(3);

  return rows;
}

/**
 * Membuat atau mengambil identitas pseudonim pelapor dari deviceId (FR-1.1, FR-7.2).
 */
export async function getOrCreateReporter(params: {
  deviceId: string;
  contactEmail?: string | null;
  shareIdentityWithAgency?: boolean;
}) {
  const deviceHash = hashWithSalt(params.deviceId || "anonymous-device");
  const pseudonymId = `warga_${deviceHash.slice(0, 10)}`;

  const existing = await db
    .select()
    .from(reporters)
    .where(eq(reporters.pseudonymId, pseudonymId))
    .limit(1);

  if (existing[0]) {
    if (params.contactEmail) {
      await db
        .update(reporters)
        .set({
          contactEmail: params.contactEmail,
          consentAt: new Date(),
          shareIdentityWithAgency: Boolean(params.shareIdentityWithAgency),
        })
        .where(eq(reporters.id, existing[0].id));
    }
    return existing[0];
  }

  const [created] = await db
    .insert(reporters)
    .values({
      pseudonymId,
      deviceHash,
      contactEmail: params.contactEmail || null,
      shareIdentityWithAgency: Boolean(params.shareIdentityWithAgency),
      consentAt: params.contactEmail ? new Date() : null,
    })
    .returning();

  return created;
}

export interface SaveReportFactsPayload {
  deviceId: string;
  lat: number;
  lng: number;
  gpsAccuracyMeters?: number | null;
  locationSource?: "GPS" | "MANUAL_PIN";
  suggestedStreetName?: string | null;
  category: "LUBANG" | "RETAK" | "AMBLAS" | "BERGELOMBANG" | "GENANGAN_DRAINASE" | "LAINNYA";
  sizeClass: "KECIL" | "SEDANG" | "BESAR";
  sizeLengthCm?: number | null;
  sizeWidthCm?: number | null;
  sizeDepthCm?: number | null;
  landmark: string;
  observedAt?: string | null;
  impactTags?: string[];
  freeText?: string | null;
  photoIds?: string[];
  contactEmail?: string | null;
  shareIdentityWithAgency?: boolean;
}

/** Classes are citizen estimates; numeric dimensions remain optional for older clients. */
function validateReportFacts(payload: SaveReportFactsPayload) {
  if (!["KECIL", "SEDANG", "BESAR"].includes(payload.sizeClass)) throw new Error("Pilih kelas ukuran kecil, sedang, atau besar.");
  if (payload.observedAt && (!Number.isFinite(Date.parse(payload.observedAt)) || Date.parse(payload.observedAt) > Date.now())) throw new Error("Waktu pengamatan tidak valid atau berada di masa depan.");
  if (!payload.landmark?.trim()) throw new Error("Patokan lokasi wajib diisi.");
  if (!Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) throw new Error("Koordinat lokasi tidak valid.");
  if (!Array.isArray(payload.photoIds) || payload.photoIds.length === 0) throw new Error("Tambahkan foto kerusakan terlebih dahulu.");
  for (const value of [payload.sizeLengthCm, payload.sizeWidthCm, payload.sizeDepthCm]) {
    if (value != null && (!Number.isFinite(value) || value <= 0)) throw new Error("Ukuran numerik harus lebih dari nol jika diisi.");
  }
}

type PhotoTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Claim uploaded evidence atomically; never move evidence belonging to another report. */
export async function linkReportPhotos(tx: PhotoTransaction, reportId: string, photoIds: string[]) {
  const ids = [...new Set(photoIds)];
  if (ids.length === 0 || ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error("Foto tidak valid. Unggah kembali foto kerusakan.");
  }
  const linked = await tx.update(reportPhotos).set({ reportId }).where(and(
    inArray(reportPhotos.id, ids),
    inArray(reportPhotos.kind, ["REPORT", "BEFORE"]),
    or(isNull(reportPhotos.reportId), eq(reportPhotos.reportId, reportId)),
  )).returning({ id: reportPhotos.id });
  if (linked.length !== ids.length) throw new Error("Foto tidak ditemukan atau sudah digunakan laporan lain. Unggah kembali foto Anda.");
}

/**
 * POST /v1/reports — Inisialisasi laporan baru berstatus DRAFT beserta Versi 1 Fakta Asal (`facts_hash`).
 */
export async function createDraftReportWithFacts(payload: SaveReportFactsPayload) {
  validateReportFacts(payload);
  const reporter = await getOrCreateReporter({
    deviceId: payload.deviceId,
    contactEmail: payload.contactEmail,
    shareIdentityWithAgency: payload.shareIdentityWithAgency,
  });

  const observedAtIso = payload.observedAt
    ? new Date(payload.observedAt).toISOString()
    : null;

  const photoIds =
    payload.photoIds!;

  const factsHash = computeFactsHash({
    category: payload.category,
    sizeLengthCm: payload.sizeLengthCm ?? null,
    sizeWidthCm: payload.sizeWidthCm ?? null,
    sizeDepthCm: payload.sizeDepthCm ?? null,
    sizeClass: payload.sizeClass,
    landmark: payload.landmark,
    observedAt: observedAtIso,
    impactTags: payload.impactTags ?? [],
    freeText: payload.freeText ?? "",
    lat: payload.lat,
    lng: payload.lng,
    photoIds,
  });

  const { districtName, subdistrictName } = resolveBogorDistrict(payload.lat, payload.lng);
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const ticketCode = `SJG-2026-${randomSuffix}`;
  const trackingToken = `trk_${crypto.randomBytes(12).toString("hex")}`;

  return db.transaction(async (tx) => {
  const [report] = await tx
    .insert(reports)
    .values({
      ticketCode,
      trackingToken,
      reporterId: reporter.id,
      status: "DRAFT",
      location: { lng: payload.lng, lat: payload.lat },
      lat: String(payload.lat),
      lng: String(payload.lng),
      locationSource: payload.locationSource ?? "GPS",
      districtName,
      subdistrictName,
      suggestedStreetName: payload.suggestedStreetName ?? null,
      currentFactsHash: factsHash,
      priorityScore: payload.sizeClass === "BESAR" ? "85.00" : payload.sizeClass === "SEDANG" ? "72.50" : "55.00",
    })
    .returning();

  await linkReportPhotos(tx, report.id, photoIds);

  const [factVersion] = await tx
    .insert(reportFactVersions)
    .values({
      reportId: report.id,
      versionNo: 1,
      category: payload.category,
      sizeLengthCm: payload.sizeLengthCm != null ? String(payload.sizeLengthCm) : null,
      sizeWidthCm: payload.sizeWidthCm != null ? String(payload.sizeWidthCm) : null,
      sizeDepthCm: payload.sizeDepthCm != null ? String(payload.sizeDepthCm) : null,
      sizeClass: payload.sizeClass,
      landmark: payload.landmark,
      observedAt: observedAtIso ? new Date(observedAtIso) : null,
      impactTags: payload.impactTags ?? [],
      freeText: payload.freeText ?? null,
      lat: String(payload.lat),
      lng: String(payload.lng),
      gpsAccuracyM: payload.gpsAccuracyMeters != null ? String(payload.gpsAccuracyMeters) : null,
      photoIds,
      factsHash,
      createdByActor: reporter.pseudonymId,
    })
    .returning();

  await tx
    .update(reports)
    .set({ currentFactsVersionId: factVersion.id })
    .where(eq(reports.id, report.id));

  return {
    reportId: report.id,
    ticketCode: report.ticketCode,
    trackingToken: report.trackingToken,
    versionNo: 1,
    factsHash,
    districtName,
    subdistrictName,
  };
  });
}

/**
 * PUT /v1/reports/:id/facts — Memperbarui Fakta Asal.
 * Menegakkan Aturan FR-3.4 / US-05:
 * Jika Fakta Asal berubah setelah draf dibuat/disetujui, sistem membuat versi fakta baru,
 * menandai draf lama `is_stale = true`, membatalkan persetujuan (`is_valid = false`),
 * dan menulis log `SOURCE_FACTS_MODIFIED` serta `APPROVAL_RESET`.
 */
export async function updateReportFactsAndInvalidateApproval(
  reportId: string,
  payload: SaveReportFactsPayload,
  rawIp?: string
) {
  validateReportFacts(payload);
  return db.transaction(async (tx) => {
  const existingReport = await tx
    .select()
    .from(reports)
    .where(eq(reports.id, reportId))
    .limit(1).for("update");

  if (!existingReport[0]) {
    throw new Error("REPORT_NOT_FOUND");
  }

  const lastVersion = await tx
    .select()
    .from(reportFactVersions)
    .where(eq(reportFactVersions.reportId, reportId))
    .orderBy(desc(reportFactVersions.versionNo))
    .limit(1);

  const nextVersionNo = (lastVersion[0]?.versionNo ?? 0) + 1;
  const observedAtIso = payload.observedAt
    ? new Date(payload.observedAt).toISOString()
    : null;
  const photoIds =
    payload.photoIds!;

  await linkReportPhotos(tx, reportId, photoIds);

  const newFactsHash = computeFactsHash({
    category: payload.category,
    sizeLengthCm: payload.sizeLengthCm ?? null,
    sizeWidthCm: payload.sizeWidthCm ?? null,
    sizeDepthCm: payload.sizeDepthCm ?? null,
    sizeClass: payload.sizeClass,
    landmark: payload.landmark,
    observedAt: observedAtIso,
    impactTags: payload.impactTags ?? [],
    freeText: payload.freeText ?? "",
    lat: payload.lat,
    lng: payload.lng,
    photoIds,
  });

  const hashChanged = newFactsHash !== existingReport[0].currentFactsHash;
  const { districtName, subdistrictName } = resolveBogorDistrict(payload.lat, payload.lng);

  const [newFactVersion] = await tx
    .insert(reportFactVersions)
    .values({
      reportId,
      versionNo: nextVersionNo,
      category: payload.category,
      sizeLengthCm: payload.sizeLengthCm != null ? String(payload.sizeLengthCm) : null,
      sizeWidthCm: payload.sizeWidthCm != null ? String(payload.sizeWidthCm) : null,
      sizeDepthCm: payload.sizeDepthCm != null ? String(payload.sizeDepthCm) : null,
      sizeClass: payload.sizeClass,
      landmark: payload.landmark,
      observedAt: observedAtIso ? new Date(observedAtIso) : null,
      impactTags: payload.impactTags ?? [],
      freeText: payload.freeText ?? null,
      lat: String(payload.lat),
      lng: String(payload.lng),
      gpsAccuracyM: payload.gpsAccuracyMeters != null ? String(payload.gpsAccuracyMeters) : null,
      photoIds,
      factsHash: newFactsHash,
      createdByActor: lastVersion[0]?.createdByActor ?? "warga_pseudonim",
    })
    .returning();

  if (hashChanged) {
    // 1. Tandai seluruh draf sebelumnya kedaluwarsa (is_stale = true)
    await tx
      .update(reportDrafts)
      .set({ isStale: true })
      .where(eq(reportDrafts.reportId, reportId));

    // 2. Batalkan seluruh persetujuan yang pernah diberikan
    await tx
      .update(reportApprovals)
      .set({
        isValid: false,
        resetAt: new Date(),
        resetReason: "SOURCE_FACTS_MODIFIED",
      })
      .where(eq(reportApprovals.reportId, reportId));

    // 3. Perbarui laporan utama & kosongkan approvedDraftId
    await tx
      .update(reports)
      .set({
        location: { lng: payload.lng, lat: payload.lat },
        lat: String(payload.lat),
        lng: String(payload.lng),
        districtName,
        subdistrictName,
        currentFactsVersionId: newFactVersion.id,
        currentFactsHash: newFactsHash,
        approvedDraftId: null,
        updatedAt: new Date(),
      })
      .where(eq(reports.id, reportId));

    // 4. Catat ke append-only audit log (FR-3.7)
    await appendAuditLog({
      reportId,
      actorId: newFactVersion.createdByActor,
      actorType: "WARGA_PSEUDONIM",
      actionType: "SOURCE_FACTS_MODIFIED",
      snapshotBefore: {
        versionNo: lastVersion[0]?.versionNo,
        factsHash: existingReport[0].currentFactsHash,
      },
      snapshotAfter: {
        versionNo: nextVersionNo,
        factsHash: newFactsHash,
        landmark: payload.landmark,
        sizeDepthCm: payload.sizeDepthCm,
      },
      rawIp,
    }, tx);

    await appendAuditLog({
      reportId,
      actorId: "system_hash_guard",
      actorType: "SISTEM",
      actionType: "APPROVAL_RESET",
      snapshotBefore: { approvedDraftId: existingReport[0].approvedDraftId },
      snapshotAfter: {
        approvedDraftId: null,
        reason: "SOURCE_FACTS_MODIFIED",
        newFactsHash,
      },
      rawIp,
    }, tx);
  }

  return {
    reportId,
    versionNo: nextVersionNo,
    factsHash: newFactsHash,
    approvalReset: hashChanged,
    approvalResetBanner: hashChanged
      ? "Data Fakta Asal Anda telah berubah. Persetujuan sebelumnya dibatalkan otomatis. Silakan buat ulang dan tinjau kembali draf sebelum mengirim."
      : null,
  };
  });
}

/**
 * POST /v1/reports/:id/drafts/generate — Memanggil OpenAI `gpt-6-luna` (reasoning medium) / Fallback Template,
 * menyimpan ke tabel `report_drafts`, dan mencatat audit log `AI_GENERATE_SUCCESS` atau `AI_FALLBACK_TEMPLATE`.
 */
export async function generateAndSaveReportDraft(
  reportId: string,
  options?: { forceFallback?: boolean; rawIp?: string }
) {
  const [report] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1);
  if (!report || !report.currentFactsVersionId) {
    throw new Error("REPORT_NOT_FOUND");
  }

  const [factVersion] = await db
    .select()
    .from(reportFactVersions)
    .where(eq(reportFactVersions.id, report.currentFactsVersionId))
    .limit(1);

  if (!factVersion) {
    throw new Error("FACT_VERSION_NOT_FOUND");
  }

  const canonicalInput = {
    category: factVersion.category,
    sizeClass: factVersion.sizeClass,
    sizeLengthCm: factVersion.sizeLengthCm,
    sizeWidthCm: factVersion.sizeWidthCm,
    sizeDepthCm: factVersion.sizeDepthCm,
    landmark: factVersion.landmark,
    observedAt: factVersion.observedAt?.toISOString() ?? null,
    impactTags: factVersion.impactTags ?? [],
    freeText: factVersion.freeText,
    lat: factVersion.lat,
    lng: factVersion.lng,
    photoIds: factVersion.photoIds ?? [],
  };

  // Explicit template requests bypass the AI client entirely.
  const draftResult = await generateReportDraft(canonicalInput, { useTemplate: options?.forceFallback });

  const [savedDraft] = await db
    .insert(reportDrafts)
    .values({
      reportId: report.id,
      factsVersionId: factVersion.id,
      sourceType: draftResult.sourceType,
      title: draftResult.title,
      body: draftResult.body,
      modelName: draftResult.modelName,
      reasoningEffort: draftResult.reasoningEffort,
      promptVersion: draftResult.promptVersion,
      fallbackReason: draftResult.fallbackReason,
      validatorResult: draftResult.validatorResult,
      latencyMs: draftResult.latencyMs,
      factsHash: factVersion.factsHash,
      isStale: false,
    })
    .returning();

  await appendAuditLog({
    reportId: report.id,
    actorId: draftResult.sourceType === "AI" ? `openai:${draftResult.modelName}` : "template_engine",
    actorType: draftResult.sourceType === "AI" ? "AI" : "SISTEM",
    actionType:
      draftResult.sourceType === "AI" ? "AI_GENERATE_SUCCESS" : "AI_FALLBACK_TEMPLATE",
    snapshotBefore: { factsHash: factVersion.factsHash },
    snapshotAfter: {
      draftId: savedDraft.id,
      sourceType: savedDraft.sourceType,
      title: savedDraft.title,
      fallbackReason: savedDraft.fallbackReason,
      latencyMs: savedDraft.latencyMs,
    },
    rawIp: options?.rawIp,
  });

  return {
    draftId: savedDraft.id,
    reportId: report.id,
    factsHash: savedDraft.factsHash,
    ...draftResult,
  };
}

/**
 * POST /v1/reports/:id/approve — Mencatat persetujuan eksplisit warga atas draf (FR-3.2).
 */
export async function approveReportDraft(params: {
  reportId: string;
  draftId: string;
  factsHash: string;
  rawIp?: string;
}) {
  const [report] = await db
    .select()
    .from(reports)
    .where(eq(reports.id, params.reportId))
    .limit(1);

  if (!report) throw new Error("REPORT_NOT_FOUND");
  if (report.currentFactsHash !== params.factsHash) {
    const err = new Error("APPROVAL_HASH_MISMATCH") as Error & { status?: number };
    err.status = 409;
    throw err;
  }

  const [approval] = await db
    .insert(reportApprovals)
    .values({
      reportId: report.id,
      draftId: params.draftId,
      approvedFactsHash: params.factsHash,
      isValid: true,
    })
    .returning();

  await db
    .update(reports)
    .set({ approvedDraftId: params.draftId, updatedAt: new Date() })
    .where(eq(reports.id, report.id));

  await appendAuditLog({
    reportId: report.id,
    actorId: "warga_pelapor",
    actorType: "WARGA_PSEUDONIM",
    actionType: "APPROVAL_GRANTED",
    snapshotBefore: { approvedDraftId: null },
    snapshotAfter: {
      approvalId: approval.id,
      draftId: params.draftId,
      approvedFactsHash: params.factsHash,
    },
    rawIp: params.rawIp,
  });

  return approval;
}

/**
 * POST /v1/reports/:id/submit — Mengirim laporan final (FR-3.5, FR-3.6, US-06).
 * Menolak dengan 409 Conflict bila `approvedFactsHash !== current_facts_hash`.
 */
export async function submitReportFinal(params: {
  reportId: string;
  draftId: string;
  approvedFactsHash: string;
  idempotencyKey?: string;
  rawIp?: string;
}) {
  const [report] = await db
    .select()
    .from(reports)
    .where(eq(reports.id, params.reportId))
    .limit(1);

  if (!report) throw new Error("REPORT_NOT_FOUND");

  // Idempotency check (US-06 / E-04)
  if (report.status !== "DRAFT" && report.idempotencyKey === params.idempotencyKey) {
    return {
      reportId: report.id,
      ticketCode: report.ticketCode,
      trackingToken: report.trackingToken,
      status: report.status,
      submittedAt: report.submittedAt,
      idempotentReplay: true,
    };
  }

  // Penegakan Server FR-3.5: Tolak 409 jika hash fakta tidak cocok!
  if (report.currentFactsHash !== params.approvedFactsHash) {
    const err = new Error("APPROVAL_HASH_MISMATCH") as Error & { status?: number };
    err.status = 409;
    throw err;
  }

  const submittedAt = new Date();
  await db
    .update(reports)
    .set({
      status: "MENUNGGU_VERIFIKASI",
      approvedDraftId: params.draftId,
      submittedAt,
      idempotencyKey: params.idempotencyKey ?? `idem_${report.id}`,
      updatedAt: submittedAt,
    })
    .where(eq(reports.id, report.id));

  await appendAuditLog({
    reportId: report.id,
    actorId: "warga_pelapor",
    actorType: "WARGA_PSEUDONIM",
    actionType: "REPORT_SUBMITTED",
    snapshotBefore: { status: "DRAFT" },
    snapshotAfter: {
      status: "MENUNGGU_VERIFIKASI",
      ticketCode: report.ticketCode,
      approvedFactsHash: params.approvedFactsHash,
      draftId: params.draftId,
    },
    rawIp: params.rawIp,
  });

  return {
    reportId: report.id,
    ticketCode: report.ticketCode,
    trackingToken: report.trackingToken,
    status: "MENUNGGU_VERIFIKASI",
    submittedAt,
    idempotentReplay: false,
  };
}

/**
 * GET /v1/track/:ticketCodeOrToken — Mengambil data pelacakan tiket tanpa login (FR-8.1, FR-8.2).
 */
export async function getReportTrackingDetails(ticketCodeOrToken: string) {
  const code = ticketCodeOrToken.trim();
  const [report] = await db
    .select()
    .from(reports)
    .where(eq(reports.ticketCode, code.toUpperCase()))
    .limit(1);

  if (!report) {
    return null;
  }

  const [draft] = report.approvedDraftId
    ? await db
        .select()
        .from(reportDrafts)
        .where(eq(reportDrafts.id, report.approvedDraftId))
        .limit(1)
    : [];

  const [factVersion] = report.currentFactsVersionId
    ? await db
        .select()
        .from(reportFactVersions)
        .where(eq(reportFactVersions.id, report.currentFactsVersionId))
        .limit(1)
    : [];

  const [agency] = report.assignedAgencyId
    ? await db
        .select()
        .from(agencies)
        .where(eq(agencies.id, report.assignedAgencyId))
        .limit(1)
    : [];

  const photos = await db
    .select()
    .from(reportPhotos)
    .where(eq(reportPhotos.reportId, report.id));

  return {
    id: report.id,
    ticketCode: report.ticketCode,
    trackingToken: report.trackingToken,
    status: report.status,
    districtName: report.districtName,
    subdistrictName: report.subdistrictName,
    lat: Number(report.lat),
    lng: Number(report.lng),
    upvoteCount: report.upvoteCount,
    priorityScore: Number(report.priorityScore),
    isRecurrentHotspot: report.isRecurrentHotspot,
    submittedAt: report.submittedAt,
    verifiedAt: report.verifiedAt,
    forwardedAt: report.forwardedAt,
    resolvedAt: report.resolvedAt,
    assignedAgencyName: agency?.name ?? null,
    draft: draft
      ? {
          sourceType: draft.sourceType,
          permanentLabel:
            draft.sourceType === "AI" ? "✨ [Draf Dibantu AI]" : "📄 [Draf Template]",
          title: draft.title,
          body: draft.body,
        }
      : null,
    facts: factVersion
      ? {
          category: factVersion.category,
          sizeClass: factVersion.sizeClass,
          sizeLengthCm: factVersion.sizeLengthCm,
          sizeWidthCm: factVersion.sizeWidthCm,
          sizeDepthCm: factVersion.sizeDepthCm,
          landmark: factVersion.landmark,
          freeText: factVersion.freeText,
          factsHash: factVersion.factsHash,
        }
      : null,
    photos: photos.map((p) => ({
      id: p.id,
      kind: p.kind,
      publicUrl: p.publicUrl,
    })),
  };
}
