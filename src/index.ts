import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { desc, eq } from "drizzle-orm";
import { env } from "./config/env.js";
import { db } from "./db/index.js";
import { reportAuditLogs } from "./db/schema.js";
import { computeFactsHash } from "./utils/hash.js";
import { generateReportDraft } from "./services/aiDraft.service.js";
import {
  generateCloudinaryUploadSignature,
  registerUploadedPhoto,
} from "./services/cloudinary.service.js";
import {
  resolveBogorDistrict,
  findNearbyActiveReports,
  createDraftReportWithFacts,
  updateReportFactsAndInvalidateApproval,
  generateAndSaveReportDraft,
  approveReportDraft,
  submitReportFinal,
  getReportTrackingDetails,
} from "./services/report.service.js";
import { requestEmailOtp, verifyEmailOtp } from "./services/email.service.js";
import {
  listEnrichedReports,
  toggleReportUpvote,
  addReportConditionTag,
  submitCommunitySignoff,
  adminVerifyReport,
  adminRejectReport,
  adminMergeDuplicateReport,
  adminToggleBlurReportPhoto,
  adminEscalateReportToAgency,
  agencyUpdateReportStatus,
  agencyReturnReportToAdmin,
  getSystemConfigs,
  updateSystemConfigs,
} from "./services/moderation.service.js";
import {
  getWeatherRoadIntelligenceSummary,
  syncBogorWeatherAndHotspots,
} from "./services/weather.service.js";
import {
  generatePublicReportsCsv,
  generateOfficialReportDocumentHtml,
} from "./services/analytics.service.js";

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: [env.FRONTEND_URL, "http://localhost:3000"],
    credentials: true,
  })
);
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(env.API_PREFIX, apiLimiter);

const v1Router = express.Router();

// ============================================================================
// 1. HEALTH CHECK & GEOCODING / UPLOAD (F1)
// ============================================================================
v1Router.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: {
      service: "sijago-backend",
      version: "1.0.0-mia2026",
      status: "ok",
      aiModel: env.OPENAI_MODEL,
      aiReasoningEffort: env.OPENAI_REASONING_EFFORT,
      weatherProvider: env.WEATHER_PRIMARY_PROVIDER,
      timestamp: new Date().toISOString(),
    },
  });
});

v1Router.post("/geo/validate-point", async (req, res) => {
  const { lat, lng } = req.body as { lat?: number; lng?: number };
  if (typeof lat !== "number" || typeof lng !== "number") {
    res.status(400).json({
      success: false,
      error: {
        title: "Koordinat Tidak Valid",
        status: 400,
        code: "INVALID_COORDINATES",
        detail: "Nilai lat dan lng wajib berupa angka.",
      },
    });
    return;
  }

  const isInsideBogorCity =
    lat >= -6.685 && lat <= -6.505 && lng >= 106.725 && lng <= 106.865;

  const { districtName, subdistrictName } = resolveBogorDistrict(lat, lng);

  let suggestedStreetName = `Area ${districtName}, Kota Bogor`;
  try {
    const nominatimUrl = `${env.OSM_NOMINATIM_BASE_URL}/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
    const geoRes = await fetch(nominatimUrl, {
      headers: { "User-Agent": env.APP_USER_AGENT },
    });
    if (geoRes.ok) {
      const geoData = (await geoRes.json()) as { display_name?: string };
      if (geoData.display_name) {
        suggestedStreetName = geoData.display_name;
      }
    }
  } catch {
    // Graceful degradation
  }

  let nearbyActiveReports: unknown[] = [];
  if (isInsideBogorCity) {
    try {
      nearbyActiveReports = await findNearbyActiveReports(lat, lng, 30);
    } catch {
      nearbyActiveReports = [];
    }
  }

  res.json({
    success: true,
    data: {
      isInsideBogorCity,
      lat,
      lng,
      districtName,
      subdistrictName,
      suggestedStreetName,
      nearbyActiveReports,
    },
  });
});

v1Router.post("/uploads/cloudinary-sign", async (req, res) => {
  try {
    const body = req.body as {
      registerPhoto?: boolean;
      reportId?: string;
      kind?: "REPORT" | "BEFORE" | "AFTER" | "SIGNOFF";
      cloudinaryPublicId?: string;
      originalSecureUrl?: string;
      reportLat?: number;
      reportLng?: number;
      exifLat?: number | null;
      exifLng?: number | null;
      exifTakenAt?: string | null;
    };

    if (body?.registerPhoto && body.cloudinaryPublicId && body.originalSecureUrl) {
      const photo = await registerUploadedPhoto({
        reportId: body.reportId ?? null,
        kind: body.kind ?? "REPORT",
        cloudinaryPublicId: body.cloudinaryPublicId,
        originalSecureUrl: body.originalSecureUrl,
        reportLat: body.reportLat,
        reportLng: body.reportLng,
        exifLat: body.exifLat,
        exifLng: body.exifLng,
        exifTakenAt: body.exifTakenAt,
        uploadedByActor: String(req.headers["x-device-id"] || "warga_pelapor"),
      });

      res.json({ success: true, data: { photo } });
      return;
    }

    const sig = generateCloudinaryUploadSignature();
    res.json({ success: true, data: sig });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: {
        title: "Gagal Memproses Upload Foto",
        status: 500,
        code: "UPLOAD_SIGN_FAILED",
        detail: err instanceof Error ? err.message : "Unknown error",
      },
    });
  }
});

// ============================================================================
// 2. PELAPORAN WARGA, AI DRAFTING & PANEL SANDING HASH (F1, F2, F3)
// ============================================================================
v1Router.post("/reports", async (req, res) => {
  try {
    const deviceId = String(req.headers["x-device-id"] || req.body.deviceId || "web-client-bogor");
    const created = await createDraftReportWithFacts({
      ...req.body,
      deviceId,
    });
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: {
        title: "Gagal Menyimpan Fakta Asal Laporan",
        status: 400,
        code: "CREATE_REPORT_FAILED",
        detail: err instanceof Error ? err.message : "Invalid payload",
      },
    });
  }
});

v1Router.put("/reports/:id/facts", async (req, res) => {
  try {
    const deviceId = String(req.headers["x-device-id"] || req.body.deviceId || "web-client-bogor");
    const updated = await updateReportFactsAndInvalidateApproval(
      req.params.id,
      { ...req.body, deviceId },
      req.ip
    );
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: {
        title: "Gagal Memperbarui Fakta Asal",
        status: 400,
        code: "UPDATE_FACTS_FAILED",
        detail: err instanceof Error ? err.message : "Invalid payload",
      },
    });
  }
});

v1Router.post("/reports/:id/drafts/generate", async (req, res) => {
  try {
    const forceFallback = Boolean(req.body?.forceFallback);
    const draft = await generateAndSaveReportDraft(req.params.id, {
      forceFallback,
      rawIp: req.ip,
    });
    res.json({ success: true, data: draft });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: {
        title: "Gagal Membuat Draf Laporan",
        status: 400,
        code: "DRAFT_GENERATE_FAILED",
        detail: err instanceof Error ? err.message : "Unknown error",
      },
    });
  }
});

v1Router.post("/reports/:id/approve", async (req, res) => {
  try {
    const { draftId, factsHash } = req.body as { draftId: string; factsHash: string };
    const approval = await approveReportDraft({
      reportId: req.params.id,
      draftId,
      factsHash,
      rawIp: req.ip,
    });
    res.json({ success: true, data: approval });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status ?? 400;
    res.status(status).json({
      success: false,
      error: {
        title: status === 409 ? "Persetujuan Draf Tidak Valid" : "Gagal Menyimpan Persetujuan",
        status,
        code: status === 409 ? "APPROVAL_HASH_MISMATCH" : "APPROVAL_FAILED",
        detail:
          status === 409
            ? "Fakta Asal telah berubah setelah draf dibuat. Silakan perbarui dan tinjau ulang draf."
            : err instanceof Error
              ? err.message
              : "Error",
      },
    });
  }
});

v1Router.post("/reports/:id/submit", async (req, res) => {
  try {
    const { draftId, approvedFactsHash } = req.body as {
      draftId: string;
      approvedFactsHash: string;
    };
    const idempotencyKey = String(req.headers["idempotency-key"] || `idem_${req.params.id}`);

    const submitted = await submitReportFinal({
      reportId: req.params.id,
      draftId,
      approvedFactsHash,
      idempotencyKey,
      rawIp: req.ip,
    });

    res.status(201).json({ success: true, data: submitted });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status ?? 400;
    res.status(status).json({
      success: false,
      error: {
        title:
          status === 409 ? "Pengiriman Ditolak: Hash Fakta Tidak Cocok" : "Gagal Mengirim Laporan",
        status,
        code: status === 409 ? "APPROVAL_HASH_MISMATCH" : "SUBMIT_FAILED",
        detail:
          status === 409
            ? "Server mendeteksi Fakta Asal telah berubah setelah persetujuan diberikan (FR-3.5). Silakan tinjau ulang draf."
            : err instanceof Error
              ? err.message
              : "Error",
      },
    });
  }
});

// ============================================================================
// 3. PETA PUBLIK, UPVOTE (+1), OTP EMAIL RESEND, TAG & SIGN-OFF (F4, F8, F10)
// ============================================================================
v1Router.get("/public/reports", async (req, res) => {
  try {
    const district = req.query.district ? String(req.query.district) : undefined;
    const category = req.query.category ? String(req.query.category) : undefined;
    const rows = await listEnrichedReports({
      publicOnly: true,
      district,
      category,
    });
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: {
        title: "Gagal Mengambil Daftar Laporan Publik",
        status: 500,
        code: "PUBLIC_REPORTS_ERROR",
        detail: err instanceof Error ? err.message : "Error",
      },
    });
  }
});

v1Router.get("/public/reports/:id", async (req, res) => {
  try {
    const rows = await listEnrichedReports({ publicOnly: false });
    const found = rows.find(
      (r) =>
        r.id === req.params.id ||
        r.ticketCode.toUpperCase() === req.params.id.toUpperCase()
    );
    if (!found) {
      res.status(404).json({
        success: false,
        error: {
          title: "Laporan Tidak Ditemukan",
          status: 404,
          code: "NOT_FOUND",
          detail: "Laporan tidak ditemukan.",
        },
      });
      return;
    }
    res.json({ success: true, data: found });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: {
        title: "Gagal Mengambil Detail Laporan",
        status: 500,
        code: "DETAIL_ERROR",
        detail: err instanceof Error ? err.message : "Error",
      },
    });
  }
});

v1Router.post("/public/reports/:id/upvote", async (req, res) => {
  try {
    const deviceId = String(
      req.headers["x-device-id"] ||
        req.body?.fingerprint ||
        req.body?.deviceId ||
        req.ip ||
        "anon-voter"
    );
    const result = await toggleReportUpvote(req.params.id, deviceId);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: {
        title: "Gagal Memproses Dukungan (+1)",
        status: 400,
        code: "UPVOTE_FAILED",
        detail: err instanceof Error ? err.message : "Error",
      },
    });
  }
});

v1Router.post("/auth/otp/request", async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email || !email.includes("@")) {
    res.status(400).json({
      success: false,
      error: {
        title: "Email Tidak Valid",
        status: 400,
        code: "INVALID_EMAIL",
        detail: "Masukkan alamat email yang valid.",
      },
    });
    return;
  }
  const result = await requestEmailOtp(email);
  res.json({
    success: true,
    data: {
      ...result,
      devOtpCode: result.demoOtpHint,
    },
  });
});

v1Router.post("/auth/otp/verify", (req, res) => {
  const { email, code } = req.body as { email?: string; code?: string };
  const result = verifyEmailOtp(email || "", code || "");
  if (!result.valid) {
    res.status(400).json({
      success: false,
      error: {
        title: "Kode OTP Salah atau Kedaluwarsa",
        status: 400,
        code: "INVALID_OTP",
        detail: "Kode OTP yang Anda masukkan tidak cocok.",
      },
    });
    return;
  }
  res.json({
    success: true,
    data: {
      ...result,
      verified: result.valid,
      otpToken: result.verifiedEmailHash,
    },
  });
});

v1Router.post("/public/reports/:id/tags", async (req, res) => {
  try {
    const { tagCode, verifiedEmailHash, otpToken } = req.body as {
      tagCode: string;
      verifiedEmailHash?: string;
      otpToken?: string;
    };
    const deviceId = String(req.headers["x-device-id"] || req.ip || "anon-tagger");
    const result = await addReportConditionTag({
      reportIdOrCode: req.params.id,
      tagCode,
      deviceId,
      verifiedEmailHash: verifiedEmailHash || otpToken || "verified_otp_session",
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: {
        title: "Gagal Menambahkan Tag Kondisi",
        status: 400,
        code: "ADD_TAG_FAILED",
        detail: err instanceof Error ? err.message : "Error",
      },
    });
  }
});

v1Router.post("/public/reports/:id/signoff", async (req, res) => {
  try {
    const { rating, decision, comment, fingerprint } = req.body as {
      rating?: "MULUS" | "CEPAT_RUSAK";
      decision?: "MULUS" | "CEPAT_RUSAK";
      comment?: string;
      fingerprint?: string;
    };
    const chosenRating = rating || decision || "MULUS";
    const deviceId = String(
      req.headers["x-device-id"] || fingerprint || req.ip || "anon-signoff"
    );
    const result = await submitCommunitySignoff({
      reportIdOrCode: req.params.id,
      rating: chosenRating,
      comment,
      deviceId,
      rawIp: req.ip,
    });
    res.json({
      success: true,
      data: {
        ...result,
        decision: chosenRating,
      },
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: {
        title: "Gagal Menyimpan Penilaian Community Sign-Off",
        status: 400,
        code: "SIGNOFF_FAILED",
        detail: err instanceof Error ? err.message : "Error",
      },
    });
  }
});

v1Router.get("/track/:ticketCodeOrToken", async (req, res) => {
  try {
    const data = await getReportTrackingDetails(req.params.ticketCodeOrToken);
    if (!data) {
      res.status(404).json({
        success: false,
        error: {
          title: "Kode Tiket Tidak Ditemukan",
          status: 404,
          code: "TICKET_NOT_FOUND",
          detail: `Tidak ditemukan laporan dengan kode tiket ${req.params.ticketCodeOrToken}.`,
        },
      });
      return;
    }

    const auditLogs = await db
      .select()
      .from(reportAuditLogs)
      .where(eq(reportAuditLogs.reportId, data.id))
      .orderBy(desc(reportAuditLogs.occurredAt))
      .limit(20);

    res.json({
      success: true,
      data: {
        ...data,
        auditLogs,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: {
        title: "Gagal Mengambil Data Pelacakan",
        status: 500,
        code: "TRACK_ERROR",
        detail: err instanceof Error ? err.message : "Error",
      },
    });
  }
});

// ============================================================================
// 4. MODERASI ADMIN, BLUR FOTO, ROUTING, & ESKALASI EMAIL RESEND (F5, F7)
// ============================================================================
v1Router.get("/admin/reports", async (_req, res) => {
  try {
    const rows = await listEnrichedReports({ publicOnly: false });
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: {
        title: "Gagal Mengambil Antrean Moderasi Admin",
        status: 500,
        code: "ADMIN_REPORTS_ERROR",
        detail: err instanceof Error ? err.message : "Error",
      },
    });
  }
});

v1Router.post("/admin/reports/:id/verify", async (req, res) => {
  try {
    const { adminNote } = req.body as { adminNote?: string };
    const result = await adminVerifyReport(req.params.id, adminNote, req.ip);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: {
        title: "Gagal Memverifikasi Laporan",
        status: 400,
        code: "VERIFY_FAILED",
        detail: err instanceof Error ? err.message : "Error",
      },
    });
  }
});

v1Router.post("/admin/reports/:id/reject", async (req, res) => {
  try {
    const { reason, reasonCode, note, reasonDetail } = req.body as {
      reason?: string;
      reasonCode?: string;
      note?: string;
      reasonDetail?: string;
    };
    const result = await adminRejectReport(
      req.params.id,
      reason || reasonCode || "SPAM",
      note || reasonDetail,
      req.ip
    );
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: {
        title: "Gagal Menolak Laporan",
        status: 400,
        code: "REJECT_FAILED",
        detail: err instanceof Error ? err.message : "Error",
      },
    });
  }
});

v1Router.post("/admin/reports/:id/merge", async (req, res) => {
  try {
    const { parentTicketCode, masterTicketCode } = req.body as {
      parentTicketCode?: string;
      masterTicketCode?: string;
    };
    const targetCode = parentTicketCode || masterTicketCode || "SJG-2026-1042";
    const result = await adminMergeDuplicateReport(req.params.id, targetCode, req.ip);
    res.json({
      success: true,
      data: {
        ...result,
        mergedIntoTicketCode: result.parentTicket,
        masterUpvotesCount: result.newParentUpvotes,
      },
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: {
        title: "Gagal Menggabungkan Laporan Duplikat",
        status: 400,
        code: "MERGE_FAILED",
        detail: err instanceof Error ? err.message : "Error",
      },
    });
  }
});

v1Router.post("/admin/reports/:id/blur-photo", async (req, res) => {
  try {
    const { blur, blurred } = req.body as { blur?: boolean; blurred?: boolean };
    const isBlur = blur !== undefined ? Boolean(blur) : Boolean(blurred);
    const result = await adminToggleBlurReportPhoto(req.params.id, isBlur, req.ip);
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: {
        title: "Gagal Memproses Blur Foto",
        status: 400,
        code: "BLUR_FAILED",
        detail: err instanceof Error ? err.message : "Error",
      },
    });
  }
});

v1Router.post("/admin/reports/:id/escalate", async (req, res) => {
  try {
    const { agencyCode, adminNote } = req.body as {
      agencyCode: string;
      adminNote?: string;
    };
    const result = await adminEscalateReportToAgency({
      reportIdOrCode: req.params.id,
      agencyCode: agencyCode || "PUPR_KOTA_BOGOR",
      adminNoteText: adminNote,
      rawIp: req.ip,
    });
    res.json({
      success: true,
      data: {
        ...result,
        sentViaResend: result.deliveryStatus === "SENT",
        messageId: result.providerMessageId || "sim-resend-msg",
      },
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: {
        title: "Gagal Mengirim Eskalasi Resmi ke Instansi",
        status: 400,
        code: "ESCALATE_FAILED",
        detail: err instanceof Error ? err.message : "Error",
      },
    });
  }
});

v1Router.get("/admin/config", async (_req, res) => {
  const rows = await getSystemConfigs();
  res.json({
    success: true,
    data: rows.map((r) => ({
      ...r,
      valueJson: typeof r.value === "string" ? r.value : JSON.stringify(r.value),
    })),
  });
});

v1Router.put("/admin/config", async (req, res) => {
  try {
    const payload = (req.body?.configs ? req.body.configs : req.body) || {};
    const rows = await updateSystemConfigs(payload, req.ip);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: {
        title: "Gagal Memperbarui Konfigurasi Sistem",
        status: 400,
        code: "CONFIG_UPDATE_FAILED",
        detail: err instanceof Error ? err.message : "Error",
      },
    });
  }
});

v1Router.get("/audit/logs", async (_req, res) => {
  const logs = await db
    .select()
    .from(reportAuditLogs)
    .orderBy(desc(reportAuditLogs.id))
    .limit(50);

  res.json({ success: true, data: logs });
});

// ============================================================================
// 5. PORTAL INSTANSI SIMULASI (F6)
// ============================================================================
v1Router.get("/agency/reports", async (req, res) => {
  try {
    const agencyCode = req.query.agencyCode ? String(req.query.agencyCode) : undefined;
    const rows = await listEnrichedReports({
      publicOnly: false,
      agencyCode,
    });
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: {
        title: "Gagal Mengambil Daftar Laporan Instansi",
        status: 500,
        code: "AGENCY_REPORTS_ERROR",
        detail: err instanceof Error ? err.message : "Error",
      },
    });
  }
});

v1Router.post("/agency/reports/:id/status", async (req, res) => {
  try {
    const { agencyCode, newStatus, plannedDate, note, afterPhotoUploaded, afterPhotoUrl } =
      req.body as {
        agencyCode?: string;
        newStatus: "DIPROSES" | "SELESAI";
        plannedDate?: string;
        note?: string;
        afterPhotoUploaded?: boolean;
        afterPhotoUrl?: string;
      };
    const result = await agencyUpdateReportStatus({
      reportIdOrCode: req.params.id,
      agencyCode: agencyCode || "PUPR_KOTA_BOGOR",
      newStatus,
      plannedDate,
      note,
      afterPhotoUploaded:
        afterPhotoUploaded !== undefined ? afterPhotoUploaded : Boolean(afterPhotoUrl),
      rawIp: req.ip,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: {
        title: "Gagal Memperbarui Status Tindak Lanjut Instansi",
        status: 400,
        code: "AGENCY_STATUS_FAILED",
        detail: err instanceof Error ? err.message : "Error",
      },
    });
  }
});

v1Router.post("/agency/reports/:id/return", async (req, res) => {
  try {
    const { agencyCode, reason } = req.body as {
      agencyCode?: string;
      reason: string;
    };
    const result = await agencyReturnReportToAdmin({
      reportIdOrCode: req.params.id,
      agencyCode: agencyCode || "PUPR_KOTA_BOGOR",
      reason: reason || "Ruas jalan bukan kewenangan instansi ini",
      rawIp: req.ip,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: {
        title: "Gagal Mengembalikan Laporan ke Admin",
        status: 400,
        code: "AGENCY_RETURN_FAILED",
        detail: err instanceof Error ? err.message : "Error",
      },
    });
  }
});

// ============================================================================
// 6. WEATHER-ROAD INTELLIGENCE (F9), EKSPOR CSV ANONIM (F7), & CETAK DOKUMEN (F2)
// ============================================================================
v1Router.get("/weather/intelligence", async (_req, res) => {
  try {
    const summary = await getWeatherRoadIntelligenceSummary();
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: {
        title: "Gagal Mengambil Data Weather-Road Intelligence",
        status: 500,
        code: "WEATHER_INTEL_ERROR",
        detail: err instanceof Error ? err.message : "Error",
      },
    });
  }
});

v1Router.post("/weather/sync", async (_req, res) => {
  try {
    await syncBogorWeatherAndHotspots();
    const summary = await getWeatherRoadIntelligenceSummary();
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: {
        title: "Gagal Menyinkronkan Data Cuaca Open-Meteo",
        status: 500,
        code: "WEATHER_SYNC_ERROR",
        detail: err instanceof Error ? err.message : "Error",
      },
    });
  }
});

v1Router.get("/analytics/export.csv", async (_req, res) => {
  try {
    const csv = await generatePublicReportsCsv();
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="sijago_bogor_laporan_anonim.csv"'
    );
    res.send(csv);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: {
        title: "Gagal Mengekspor CSV",
        status: 500,
        code: "CSV_EXPORT_ERROR",
        detail: err instanceof Error ? err.message : "Error",
      },
    });
  }
});

v1Router.get("/public/reports/:id/document", async (req, res) => {
  try {
    const html = await generateOfficialReportDocumentHtml(req.params.id);
    if (!html) {
      res.status(404).send("<h1>Laporan tidak ditemukan</h1>");
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    res.status(500).send(
      `<h1>Gagal membuat dokumen laporan: ${err instanceof Error ? err.message : "Error"}</h1>`
    );
  }
});

v1Router.post("/drafts/preview", async (req, res) => {
  const facts = req.body;
  const canonical = {
    category: facts.category ?? "LUBANG",
    sizeClass: facts.sizeClass ?? "SEDANG",
    sizeLengthCm: facts.sizeLengthCm ?? null,
    sizeWidthCm: facts.sizeWidthCm ?? null,
    sizeDepthCm: facts.sizeDepthCm ?? null,
    landmark: facts.landmark ?? "Jl. Ir. H. Juanda, Kota Bogor",
    observedAt: facts.observedAt ?? new Date().toISOString(),
    impactTags: Array.isArray(facts.impactTags) ? facts.impactTags : ["MEMBAHAYAKAN_RODA_DUA"],
    freeText: facts.freeText ?? "",
    lat: facts.lat ?? -6.5971469,
    lng: facts.lng ?? 106.8060388,
    photoIds: Array.isArray(facts.photoIds) ? facts.photoIds : ["demo-photo-1"],
  };

  const factsHash = computeFactsHash(canonical);
  const draft = await generateReportDraft(canonical);

  res.json({
    success: true,
    data: {
      factsHash,
      ...draft,
    },
  });
});

app.use(env.API_PREFIX, v1Router);

app.listen(env.PORT, () => {
  console.log(
    `🚀 [SIJAGO BACKEND] Berjalan di http://localhost:${env.PORT}${env.API_PREFIX}/health`
  );
});
