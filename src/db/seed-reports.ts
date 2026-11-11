import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v2 as cloudinary } from "cloudinary";
import { eq, inArray, like, sql } from "drizzle-orm";
import { env } from "../config/env.js";
import { db, pool } from "./index.js";
import {
  agencies,
  agencyUpdates,
  escalations,
  reportApprovals,
  reportConditionTags,
  reportDrafts,
  reportFactVersions,
  reportPhotos,
  reporters,
  reports,
  reportUpvotes,
  users,
} from "./schema.js";
import { computeFactsHash, hashWithSalt } from "../utils/hash.js";
import { buildDeterministicTemplateDraft } from "../services/aiDraft.service.js";
import { appendAuditLog } from "../services/audit.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXAMPLE_IMAGES_DIR = path.resolve(
  __dirname,
  "../../../sijago-frontend/public/images/example"
);

export interface SeedReportItem {
  ticketCode: string;
  imageFile: string;
  category: "LUBANG" | "RETAK" | "AMBLAS" | "BERGELOMBANG" | "GENANGAN_DRAINASE";
  sizeClass: "KECIL" | "SEDANG" | "BESAR";
  sizeLengthCm: number;
  sizeWidthCm: number;
  sizeDepthCm: number;
  status:
    | "MENUNGGU_VERIFIKASI"
    | "TERVERIFIKASI"
    | "DITERUSKAN"
    | "DIPROSES"
    | "SELESAI";
  districtName: string;
  subdistrictName: string;
  suggestedStreetName: string;
  landmark: string;
  freeText: string;
  lat: number;
  lng: number;
  locationSource: "GPS" | "MANUAL_PIN";
  agencyCode: "PUPR_KOTA_BOGOR" | "BINAMARGA_JABAR" | "BBPJN_NASIONAL" | null;
  upvotes: number;
  isRecurrentHotspot: boolean;
  impactTags: string[];
  conditionTags: string[];
}

/**
 * 11 Laporan Contoh dengan Kode Tiket Asli (SJG-2026-XXXX) dan Gambar dari public/images/example.
 * - 3 laporan pertama (SJG-2026-4101, SJG-2026-4102, SJG-2026-4103) dibuat berdekatan (~12 meter)
 *   di Koridor Jl. Ir. H. Juanda (Pintu 1 Kebun Raya Bogor) khusus untuk testing deteksi laporan berdekatan & penggabungan duplikat.
 */
export const SEED_REPORTS_DATA: SeedReportItem[] = [
  // =========================================================================
  // KLASTER 3 LAPORAN BERDEKATAN (JARAK ~12 METER DI JL. IR. H. JUANDA)
  // =========================================================================
  {
    ticketCode: "SJG-2026-4101",
    imageFile: "lubang_jalan_1.jpg",
    category: "LUBANG",
    sizeClass: "BESAR",
    sizeLengthCm: 95,
    sizeWidthCm: 70,
    sizeDepthCm: 14,
    status: "MENUNGGU_VERIFIKASI",
    districtName: "Bogor Tengah",
    subdistrictName: "Paledang",
    suggestedStreetName: "Jl. Ir. H. Juanda, Paledang, Bogor Tengah, Kota Bogor",
    landmark: "Depan Pintu 1 Kebun Raya Bogor, Jl. Ir. H. Juanda lajur kiri arah BTM",
    freeText:
      "Lubang jalan cukup besar dan dalam tepat di depan gerbang Pintu 1 Kebun Raya Bogor. Sangat membahayakan pengendara motor saat hujan.",
    lat: -6.597147,
    lng: 106.79912,
    locationSource: "GPS",
    agencyCode: null,
    upvotes: 5,
    isRecurrentHotspot: true,
    impactTags: ["MEMBAHAYAKAN_RODA_DUA", "MENGGANGGU_KELANCARAN_LALIN"],
    conditionTags: ["MAKIN_DALAM", "RAWAN_MALAM"],
  },
  {
    ticketCode: "SJG-2026-4102",
    imageFile: "lubang_jalan_2.jpg",
    category: "LUBANG",
    sizeClass: "SEDANG",
    sizeLengthCm: 65,
    sizeWidthCm: 50,
    sizeDepthCm: 10,
    status: "TERVERIFIKASI",
    districtName: "Bogor Tengah",
    subdistrictName: "Paledang",
    suggestedStreetName: "Jl. Ir. H. Juanda, Paledang, Bogor Tengah, Kota Bogor",
    landmark: "12 meter dari Pintu 1 Kebun Raya Bogor arah BTM, Jl. Ir. H. Juanda",
    freeText:
      "Terdapat lubang aspal terkelupas sekitar 12 meter dari Pintu 1 Kebun Raya Bogor yang membuat kendaraan harus melambat mendadak.",
    lat: -6.597225,
    lng: 106.799195,
    locationSource: "GPS",
    agencyCode: null,
    upvotes: 18,
    isRecurrentHotspot: true,
    impactTags: ["MEMBAHAYAKAN_RODA_DUA"],
    conditionTags: ["TERTUTUP_AIR", "RAWAN_MALAM"],
  },
  {
    ticketCode: "SJG-2026-4103",
    imageFile: "genangan_air_1.jpg",
    category: "GENANGAN_DRAINASE",
    sizeClass: "SEDANG",
    sizeLengthCm: 180,
    sizeWidthCm: 90,
    sizeDepthCm: 8,
    status: "DITERUSKAN",
    districtName: "Bogor Tengah",
    subdistrictName: "Paledang",
    suggestedStreetName: "Jl. Ir. H. Juanda, Paledang, Bogor Tengah, Kota Bogor",
    landmark: "Tepi trotoar Jl. Ir. H. Juanda dekat penyeberangan Pintu 1 Kebun Raya Bogor",
    freeText:
      "Saluran tali air di tepi Jl. Ir. H. Juanda tersumbat daun dan sedimen sehingga air hujan menggenangi badan jalan di titik yang berdekatan dengan lubang jalan.",
    lat: -6.597065,
    lng: 106.799045,
    locationSource: "GPS",
    agencyCode: "PUPR_KOTA_BOGOR",
    upvotes: 14,
    isRecurrentHotspot: true,
    impactTags: ["MENIMBULKAN_GENANGAN", "MEMBAHAYAKAN_RODA_DUA"],
    conditionTags: ["TERTUTUP_AIR"],
  },

  // =========================================================================
  // 8 LAPORAN LAINNYA TERSEBAR DI 6 KECAMATAN & 3 INSTANSI KEWENANGAN
  // =========================================================================
  {
    ticketCode: "SJG-2026-4104",
    imageFile: "jalan_amblas_1.jpg",
    category: "AMBLAS",
    sizeClass: "BESAR",
    sizeLengthCm: 160,
    sizeWidthCm: 95,
    sizeDepthCm: 18,
    status: "DITERUSKAN",
    districtName: "Tanah Sareal",
    subdistrictName: "Kedungbadak",
    suggestedStreetName: "Jl. KH. Sholeh Iskandar, Kedungbadak, Tanah Sareal, Kota Bogor",
    landmark: "100 meter sebelum u-turn Lotte Grosir Jl. Sholeh Iskandar arah Yasmin",
    freeText:
      "Permukaan jalan amblas cukup dalam di lajur kiri Jl. Sholeh Iskandar akibat tergerus aliran air bawah perkerasan saat hujan deras.",
    lat: -6.56124,
    lng: 106.78152,
    locationSource: "GPS",
    agencyCode: "BBPJN_NASIONAL",
    upvotes: 29,
    isRecurrentHotspot: true,
    impactTags: ["MEMBAHAYAKAN_RODA_DUA", "MENGGANGGU_KELANCARAN_LALIN"],
    conditionTags: ["MAKIN_DALAM", "SERING_CELAKA"],
  },
  {
    ticketCode: "SJG-2026-4105",
    imageFile: "jalan_amblas_2.jpg",
    category: "AMBLAS",
    sizeClass: "SEDANG",
    sizeLengthCm: 110,
    sizeWidthCm: 65,
    sizeDepthCm: 12,
    status: "DIPROSES",
    districtName: "Bogor Selatan",
    subdistrictName: "Empang",
    suggestedStreetName: "Jl. Pahlawan, Empang, Bogor Selatan, Kota Bogor",
    landmark: "Dekat simpang Jl. Pahlawan arah Bondongan",
    freeText:
      "Bahu dan tepi badan jalan mengalami penurunan/amblas sehingga membahayakan kendaraan yang melintas di malam hari.",
    lat: -6.63185,
    lng: 106.80412,
    locationSource: "GPS",
    agencyCode: "BINAMARGA_JABAR",
    upvotes: 16,
    isRecurrentHotspot: false,
    impactTags: ["MEMBAHAYAKAN_RODA_DUA"],
    conditionTags: ["RAWAN_MALAM"],
  },
  {
    ticketCode: "SJG-2026-4106",
    imageFile: "jalan_bergelombang_1.jpg",
    category: "BERGELOMBANG",
    sizeClass: "SEDANG",
    sizeLengthCm: 220,
    sizeWidthCm: 85,
    sizeDepthCm: 7,
    status: "DIPROSES",
    districtName: "Bogor Utara",
    subdistrictName: "Tegal Gundil",
    suggestedStreetName: "Jl. Achmad Adnawijaya (Pandu Raya), Bogor Utara, Kota Bogor",
    landmark: "Koridor kuliner Jl. Pandu Raya dekat Taman Corat Coret",
    freeText:
      "Lapisan aspal bergelombang dan terdorong ke samping pada titik pengereman kendaraan, licin ketika basah.",
    lat: -6.57254,
    lng: 106.81648,
    locationSource: "GPS",
    agencyCode: "PUPR_KOTA_BOGOR",
    upvotes: 11,
    isRecurrentHotspot: false,
    impactTags: ["MEMBAHAYAKAN_RODA_DUA"],
    conditionTags: ["RAWAN_MALAM"],
  },
  {
    ticketCode: "SJG-2026-4107",
    imageFile: "jalan_bergelombang_2.jpg",
    category: "BERGELOMBANG",
    sizeClass: "KECIL",
    sizeLengthCm: 120,
    sizeWidthCm: 45,
    sizeDepthCm: 4,
    status: "TERVERIFIKASI",
    districtName: "Bogor Barat",
    subdistrictName: "Loji",
    suggestedStreetName: "Jl. Dr. Semeru, Menteng, Bogor Barat, Kota Bogor",
    landmark: "Seberang pintu masuk RSUD Kota Bogor Jl. Dr. Semeru",
    freeText:
      "Permukaan jalan tidak rata dan bergelombang di lajur kendaraan roda dua arah Bubulak.",
    lat: -6.58248,
    lng: 106.75951,
    locationSource: "MANUAL_PIN",
    agencyCode: null,
    upvotes: 7,
    isRecurrentHotspot: false,
    impactTags: ["MENGGANGGU_KELANCARAN_LALIN"],
    conditionTags: [],
  },
  {
    ticketCode: "SJG-2026-4108",
    imageFile: "retak_buaya_1.jpg",
    category: "RETAK",
    sizeClass: "SEDANG",
    sizeLengthCm: 140,
    sizeWidthCm: 60,
    sizeDepthCm: 5,
    status: "MENUNGGU_VERIFIKASI",
    districtName: "Bogor Timur",
    subdistrictName: "Sukasari",
    suggestedStreetName: "Jl. Siliwangi, Sukasari, Bogor Timur, Kota Bogor",
    landmark: "Depan area pemberhentian angkot Pasar Sukasari Jl. Siliwangi",
    freeText:
      "Retak buaya memanjang pada permukaan aspal yang mulai terkelupas saat dilintasi angkutan umum.",
    lat: -6.61521,
    lng: 106.81423,
    locationSource: "GPS",
    agencyCode: null,
    upvotes: 4,
    isRecurrentHotspot: false,
    impactTags: ["MENGGANGGU_KELANCARAN_LALIN"],
    conditionTags: [],
  },
  {
    ticketCode: "SJG-2026-4109",
    imageFile: "retak_buaya_2.jpg",
    category: "RETAK",
    sizeClass: "KECIL",
    sizeLengthCm: 90,
    sizeWidthCm: 35,
    sizeDepthCm: 3,
    status: "SELESAI",
    districtName: "Bogor Tengah",
    subdistrictName: "Babakan",
    suggestedStreetName: "Jl. Raya Pajajaran, Babakan, Bogor Tengah, Kota Bogor",
    landmark: "150 meter dari Tugu Kujang arah Baranangsiang",
    freeText:
      "Retakan kulit buaya pada lajur tengah dekat Tugu Kujang yang berpotensi menjadi lubang jika kemasukan air hujan.",
    lat: -6.59942,
    lng: 106.80511,
    locationSource: "GPS",
    agencyCode: "PUPR_KOTA_BOGOR",
    upvotes: 22,
    isRecurrentHotspot: false,
    impactTags: ["MEMBAHAYAKAN_RODA_DUA"],
    conditionTags: ["MAKIN_DALAM"],
  },
  {
    ticketCode: "SJG-2026-4110",
    imageFile: "genangan_air_2.jpg",
    category: "GENANGAN_DRAINASE",
    sizeClass: "BESAR",
    sizeLengthCm: 250,
    sizeWidthCm: 120,
    sizeDepthCm: 15,
    status: "DITERUSKAN",
    districtName: "Bogor Utara",
    subdistrictName: "Bantarjati",
    suggestedStreetName: "Jl. KS Tubun, Bantarjati, Bogor Utara, Kota Bogor",
    landmark: "Dekat Simpang Talang Jl. KS Tubun arah Cibuluh",
    freeText:
      "Genangan air tinggi menutup lajur kiri setiap hujan sore akibat inlet drainase tertutup lumpur.",
    lat: -6.56681,
    lng: 106.80892,
    locationSource: "GPS",
    agencyCode: "BINAMARGA_JABAR",
    upvotes: 19,
    isRecurrentHotspot: true,
    impactTags: ["MENIMBULKAN_GENANGAN", "MENGGANGGU_KELANCARAN_LALIN"],
    conditionTags: ["TERTUTUP_AIR"],
  },
  {
    ticketCode: "SJG-2026-4111",
    imageFile: "genangan_air_3.jpg",
    category: "GENANGAN_DRAINASE",
    sizeClass: "SEDANG",
    sizeLengthCm: 160,
    sizeWidthCm: 80,
    sizeDepthCm: 10,
    status: "DIPROSES",
    districtName: "Bogor Timur",
    subdistrictName: "Tajur",
    suggestedStreetName: "Jl. Raya Tajur, Bogor Timur, Kota Bogor",
    landmark: "Depan kawasan sentra tas Jl. Raya Tajur arah Ciawi",
    freeText:
      "Limpasan air hujan menggenang di cekungan aspal Jl. Raya Tajur dan memicu kemacetan arus kendaraan.",
    lat: -6.62514,
    lng: 106.81931,
    locationSource: "GPS",
    agencyCode: "BBPJN_NASIONAL",
    upvotes: 15,
    isRecurrentHotspot: false,
    impactTags: ["MENIMBULKAN_GENANGAN", "MENGGANGGU_KELANCARAN_LALIN"],
    conditionTags: ["TERTUTUP_AIR"],
  },
];

async function resolvePhotoAsset(imageFile: string): Promise<{
  cloudinaryPublicId: string;
  publicUrl: string;
  originalSecureUrl: string;
  sha256: string;
}> {
  const localPath = path.join(EXAMPLE_IMAGES_DIR, imageFile);
  const baseName = path.basename(imageFile, path.extname(imageFile));
  const publicId = `${env.CLOUDINARY_UPLOAD_FOLDER}/seed_${baseName}`;
  const frontendStaticUrl = `/images/example/${imageFile}`;

  let fileBuffer: Buffer = Buffer.from(imageFile);
  if (fs.existsSync(localPath)) {
    fileBuffer = fs.readFileSync(localPath);
  }
  const sha256 = createHash("sha256").update(fileBuffer).digest("hex");

  // Jika Cloudinary terkonfigurasi, unggah juga ke Cloudinary agar fitur AI Duplicate Comparison berfungsi penuh
  if (
    fs.existsSync(localPath) &&
    env.CLOUDINARY_CLOUD_NAME &&
    env.CLOUDINARY_API_KEY &&
    env.CLOUDINARY_API_SECRET
  ) {
    try {
      cloudinary.config({
        cloud_name: env.CLOUDINARY_CLOUD_NAME,
        api_key: env.CLOUDINARY_API_KEY,
        api_secret: env.CLOUDINARY_API_SECRET,
        secure: true,
      });
      await cloudinary.uploader.upload(localPath, {
        public_id: `seed_${baseName}`,
        folder: env.CLOUDINARY_UPLOAD_FOLDER,
        overwrite: true,
        resource_type: "image",
      });
    } catch {
      // Tetap lanjut menggunakan URL statis frontend bila gagal unggah ke Cloudinary
    }
  }

  return {
    cloudinaryPublicId: publicId,
    publicUrl: frontendStaticUrl,
    originalSecureUrl: frontendStaticUrl,
    sha256,
  };
}

async function main() {
  console.log(
    "🌱 [SIJAGO SEED REPORTS] Memulai seeding 11 laporan menggunakan kode tiket asli (SJG-2026-XXXX) & gambar dari public/images/example..."
  );

  const agencyRows = await db.select().from(agencies);
  const agencyMap = new Map(agencyRows.map((a) => [a.code, a]));

  const [adminUser] = await db
    .select()
    .from(users)
    .where(eq(users.role, "ADMIN"))
    .limit(1);

  // Bersihkan laporan lama yang menggunakan prefix DEMO- jika ada
  const oldDemoReports = await db
    .select({ id: reports.id })
    .from(reports)
    .where(like(reports.ticketCode, "DEMO-%"));

  if (oldDemoReports.length > 0) {
    const oldIds = oldDemoReports.map((r) => r.id);
    await db.execute(sql`ALTER TABLE report_audit_logs DISABLE TRIGGER trg_protect_report_audit_logs;`);
    await db.execute(
      sql`DELETE FROM report_audit_logs WHERE report_id IN (${sql.join(
        oldIds.map((id) => sql`${id}`),
        sql`, `
      )});`
    );
    await db.execute(sql`ALTER TABLE report_audit_logs ENABLE TRIGGER trg_protect_report_audit_logs;`);
    await db.delete(reports).where(inArray(reports.id, oldIds));
    console.log(`🧹 Menghapus ${oldIds.length} laporan lama ber-prefix DEMO-...`);
  }

  const now = new Date();

  for (const [index, item] of SEED_REPORTS_DATA.entries()) {
    const idempotencyKey = `sijago-seed-real-v1:${item.ticketCode}`;
    const createdAt = new Date(now.getTime() - (SEED_REPORTS_DATA.length - index) * 3600000 * 6);

    // Jika tiket dengan kode yang sama sudah ada, hapus dulu agar dapat di-seed ulang dengan bersih
    const [existing] = await db
      .select({ id: reports.id })
      .from(reports)
      .where(eq(reports.ticketCode, item.ticketCode))
      .limit(1);

    if (existing) {
      await db.execute(sql`ALTER TABLE report_audit_logs DISABLE TRIGGER trg_protect_report_audit_logs;`);
      await db.execute(sql`DELETE FROM report_audit_logs WHERE report_id = ${existing.id};`);
      await db.execute(sql`ALTER TABLE report_audit_logs ENABLE TRIGGER trg_protect_report_audit_logs;`);
      await db.delete(reports).where(eq(reports.id, existing.id));
    }

    const pseudonymId = `warga_${hashWithSalt(item.ticketCode).slice(0, 10)}`;
    const [reporter] = await db
      .insert(reporters)
      .values({
        pseudonymId,
        deviceHash: hashWithSalt(`device:${item.ticketCode}`),
        consentAt: createdAt,
      })
      .onConflictDoUpdate({
        target: reporters.pseudonymId,
        set: { deviceHash: hashWithSalt(`device:${item.ticketCode}`) },
      })
      .returning();

    const photoMeta = await resolvePhotoAsset(item.imageFile);

    const basePriority =
      item.sizeClass === "BESAR" ? 82 : item.sizeClass === "SEDANG" ? 68 : 54;
    const priorityScore = Math.min(99.5, basePriority + item.upvotes * 0.8).toFixed(2);

    const agency = item.agencyCode ? (agencyMap.get(item.agencyCode) ?? null) : null;
    const isVerified = ["TERVERIFIKASI", "DITERUSKAN", "DIPROSES", "SELESAI"].includes(
      item.status
    );
    const isForwarded = ["DITERUSKAN", "DIPROSES", "SELESAI"].includes(item.status);
    const isInProgress = ["DIPROSES", "SELESAI"].includes(item.status);
    const isResolved = item.status === "SELESAI";

    const [createdReport] = await db
      .insert(reports)
      .values({
        ticketCode: item.ticketCode,
        trackingToken: `trk_${randomBytes(16).toString("hex")}`,
        reporterId: reporter.id,
        status: item.status,
        location: { lat: item.lat, lng: item.lng },
        lat: String(item.lat),
        lng: String(item.lng),
        locationSource: item.locationSource,
        districtName: item.districtName,
        subdistrictName: item.subdistrictName,
        suggestedStreetName: item.suggestedStreetName,
        currentFactsHash: "pending",
        assignedAgencyId: agency?.id ?? null,
        upvoteCount: item.upvotes,
        priorityScore,
        isRecurrentHotspot: item.isRecurrentHotspot,
        submittedAt: createdAt,
        verifiedAt: isVerified ? new Date(createdAt.getTime() + 1800000) : null,
        forwardedAt: isForwarded ? new Date(createdAt.getTime() + 3600000) : null,
        inProgressAt: isInProgress ? new Date(createdAt.getTime() + 7200000) : null,
        resolvedAt: isResolved ? new Date(createdAt.getTime() + 14400000) : null,
        monitoringEndsAt: isResolved
          ? new Date(now.getTime() + 28 * 24 * 3600000)
          : null,
        idempotencyKey,
        createdAt,
        updatedAt: createdAt,
      })
      .returning();

    const [createdPhoto] = await db
      .insert(reportPhotos)
      .values({
        reportId: createdReport.id,
        kind: "REPORT",
        cloudinaryPublicId: photoMeta.cloudinaryPublicId,
        publicUrl: photoMeta.publicUrl,
        originalSecureUrl: photoMeta.originalSecureUrl,
        sha256: photoMeta.sha256,
        isBlurredByAdmin: false,
        exifTakenAt: createdAt,
        exifLat: String(item.lat),
        exifLng: String(item.lng),
        exifDistanceMeters: "4.20",
        exifMismatchFlag: false,
        uploadedByActor: pseudonymId,
        uploadedAt: createdAt,
      })
      .returning();

    const canonicalFacts = {
      category: item.category,
      sizeLengthCm: item.sizeLengthCm,
      sizeWidthCm: item.sizeWidthCm,
      sizeDepthCm: item.sizeDepthCm,
      sizeClass: item.sizeClass,
      landmark: item.landmark,
      observedAt: createdAt.toISOString(),
      impactTags: item.impactTags,
      freeText: item.freeText,
      lat: item.lat,
      lng: item.lng,
      photoIds: [createdPhoto.id],
    };

    const factsHash = computeFactsHash(canonicalFacts);

    const [factVersion] = await db
      .insert(reportFactVersions)
      .values({
        reportId: createdReport.id,
        versionNo: 1,
        category: item.category,
        sizeLengthCm: String(item.sizeLengthCm),
        sizeWidthCm: String(item.sizeWidthCm),
        sizeDepthCm: String(item.sizeDepthCm),
        sizeClass: item.sizeClass,
        landmark: item.landmark,
        observedAt: createdAt,
        impactTags: item.impactTags,
        freeText: item.freeText,
        lat: String(item.lat),
        lng: String(item.lng),
        gpsAccuracyM: "6.50",
        photoIds: [createdPhoto.id],
        factsHash,
        createdByActor: pseudonymId,
        createdAt,
      })
      .returning();

    const templateDraft = buildDeterministicTemplateDraft(canonicalFacts);

    const [draft] = await db
      .insert(reportDrafts)
      .values({
        reportId: createdReport.id,
        factsVersionId: factVersion.id,
        sourceType: "TEMPLATE",
        title: templateDraft.title,
        body: templateDraft.body,
        promptVersion: "v1.0-template",
        factsHash,
        createdAt,
      })
      .returning();

    await db.insert(reportApprovals).values({
      reportId: createdReport.id,
      draftId: draft.id,
      approvedFactsHash: factsHash,
      approvedAt: createdAt,
    });

    await db
      .update(reports)
      .set({
        currentFactsVersionId: factVersion.id,
        currentFactsHash: factsHash,
        approvedDraftId: draft.id,
      })
      .where(eq(reports.id, createdReport.id));

    for (let v = 0; v < item.upvotes; v++) {
      await db.insert(reportUpvotes).values({
        reportId: createdReport.id,
        voterKey: `seed_voter_${item.ticketCode}_${v}`,
        createdAt,
      });
    }

    for (const [tagIdx, tagCode] of item.conditionTags.entries()) {
      await db.insert(reportConditionTags).values({
        reportId: createdReport.id,
        tagCode,
        voterKey: `seed_tagger_${item.ticketCode}_${tagIdx}`,
        verifiedEmailHash: hashWithSalt(`tagger_${item.ticketCode}_${tagIdx}`),
        createdAt,
      });
    }

    if (agency && isForwarded && adminUser) {
      await db.insert(escalations).values({
        reportId: createdReport.id,
        agencyId: agency.id,
        sentByUserId: adminUser.id,
        recipientEmails: agency.officialEmails.length
          ? agency.officialEmails
          : [`${agency.code.toLowerCase()}@sijago.id`],
        emailSubject: `[ESKALASI SIJAGO ${item.ticketCode}] ${templateDraft.title}`,
        emailBodySnapshot: templateDraft.body,
        deliveryStatus: "SENT",
        providerMessageId: `seed_msg_${item.ticketCode}`,
        sentAt: new Date(createdAt.getTime() + 3600000),
        updatedAt: new Date(createdAt.getTime() + 3600000),
      });
    }

    if (agency && (isInProgress || isResolved)) {
      let afterPhotoIds: string[] = [];
      if (isResolved) {
        const [afterPhoto] = await db
          .insert(reportPhotos)
          .values({
            reportId: createdReport.id,
            kind: "AFTER",
            cloudinaryPublicId: `${photoMeta.cloudinaryPublicId}_after`,
            publicUrl: photoMeta.publicUrl,
            originalSecureUrl: photoMeta.originalSecureUrl,
            sha256: photoMeta.sha256,
            isBlurredByAdmin: false,
            exifTakenAt: new Date(createdAt.getTime() + 14400000),
            exifLat: String(item.lat),
            exifLng: String(item.lng),
            exifDistanceMeters: "3.10",
            exifMismatchFlag: false,
            uploadedByActor: agency.code,
            uploadedAt: new Date(createdAt.getTime() + 14400000),
          })
          .returning();
        afterPhotoIds = [afterPhoto.id];
      }

      await db.insert(agencyUpdates).values({
        reportId: createdReport.id,
        agencyId: agency.id,
        newStatus: item.status,
        note: isResolved
          ? "Perbaikan permukaan jalan telah diselesaikan dan kini memasuki masa pemantauan komunitas 30 hari."
          : "Tim teknis lapangan sedang melakukan penanganan pada titik kerusakan.",
        afterPhotoIds,
        updatedAt: new Date(createdAt.getTime() + 14400000),
      });
    }

    await appendAuditLog({
      reportId: createdReport.id,
      actorId: pseudonymId,
      actorType: "WARGA_PSEUDONIM",
      actionType: "REPORT_SUBMITTED",
      snapshotAfter: {
        ticketCode: item.ticketCode,
        category: item.category,
        sizeClass: item.sizeClass,
        status: item.status,
        imageFile: item.imageFile,
      },
    });

    console.log(
      `✅ ${item.ticketCode} | ${item.category.padEnd(17)} | ${item.sizeClass.padEnd(6)} | ${item.status.padEnd(19)} | ${item.imageFile}`
    );
  }

  console.log(
    "\n🎉 [SIJAGO SEED REPORTS] Selesai! 11 laporan (termasuk 3 laporan berdekatan SJG-2026-4101, SJG-2026-4102, SJG-2026-4103) telah masuk ke database."
  );
}

main()
  .catch((error) => {
    console.error("❌ [SIJAGO SEED REPORTS] Gagal:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
