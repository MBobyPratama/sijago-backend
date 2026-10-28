import { eq, sql } from "drizzle-orm";
import { db, pool } from "./index.js";
import {
  agencies,
  systemConfig,
  reporters,
  reports,
  reportFactVersions,
  reportDrafts,
  reportApprovals,
  reportConditionTags,
} from "./schema.js";
import { computeFactsHash } from "../utils/hash.js";
import { appendAuditLog } from "../services/audit.service.js";
import { syncBogorWeatherAndHotspots } from "../services/weather.service.js";

async function seedSampleReport(params: {
  ticketCode: string;
  trackingToken: string;
  status: "MENUNGGU_VERIFIKASI" | "TERVERIFIKASI" | "DITERUSKAN" | "DIPROSES" | "SELESAI";
  category: "LUBANG" | "RETAK" | "AMBLAS" | "BERGELOMBANG" | "GENANGAN_DRAINASE";
  sizeClass: "KECIL" | "SEDANG" | "BESAR";
  lengthCm: number;
  widthCm: number;
  depthCm: number;
  districtName: string;
  subdistrictName: string;
  landmark: string;
  suggestedStreetName: string;
  lat: number;
  lng: number;
  locationSource: "GPS" | "MANUAL_PIN";
  draftSource: "AI" | "TEMPLATE";
  title: string;
  body: string;
  freeText: string;
  upvotes: number;
  priorityScore: string;
  agencyCode: string | null;
  isRecurrentHotspot: boolean;
  tags: string[];
}) {
  const existing = await db
    .select()
    .from(reports)
    .where(eq(reports.ticketCode, params.ticketCode))
    .limit(1);

  if (existing[0]) return;

  const [reporter] = await db
    .insert(reporters)
    .values({
      pseudonymId: `warga_${params.ticketCode.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
      deviceHash: `hash_${params.ticketCode}`,
    })
    .onConflictDoNothing()
    .returning();

  const reporterRow =
    reporter ?? (await db.select().from(reporters).limit(1))[0];

  let agencyId: string | null = null;
  if (params.agencyCode) {
    const [ag] = await db
      .select()
      .from(agencies)
      .where(eq(agencies.code, params.agencyCode))
      .limit(1);
    agencyId = ag?.id ?? null;
  }

  const observedIso = "2026-10-25T07:20:00.000Z";
  const factsHash = computeFactsHash({
    category: params.category,
    sizeClass: params.sizeClass,
    sizeLengthCm: params.lengthCm,
    sizeWidthCm: params.widthCm,
    sizeDepthCm: params.depthCm,
    landmark: params.landmark,
    observedAt: observedIso,
    impactTags: ["MEMBAHAYAKAN_RODA_DUA", "MENIMBULKAN_MACET"],
    freeText: params.freeText,
    lat: params.lat,
    lng: params.lng,
    photoIds: [`photo_${params.ticketCode}`],
  });

  const [rep] = await db
    .insert(reports)
    .values({
      ticketCode: params.ticketCode,
      trackingToken: params.trackingToken,
      reporterId: reporterRow.id,
      status: params.status,
      location: { lng: params.lng, lat: params.lat },
      lat: String(params.lat),
      lng: String(params.lng),
      locationSource: params.locationSource,
      districtName: params.districtName,
      subdistrictName: params.subdistrictName,
      suggestedStreetName: params.suggestedStreetName,
      currentFactsHash: factsHash,
      assignedAgencyId: agencyId,
      priorityScore: params.priorityScore,
      upvoteCount: params.upvotes,
      isRecurrentHotspot: params.isRecurrentHotspot,
      submittedAt: new Date("2026-10-25T07:20:00.000Z"),
      verifiedAt: params.status !== "MENUNGGU_VERIFIKASI" ? new Date("2026-10-25T09:05:00.000Z") : null,
      forwardedAt: ["DITERUSKAN", "DIPROSES", "SELESAI"].includes(params.status)
        ? new Date("2026-10-25T09:12:00.000Z")
        : null,
      resolvedAt: params.status === "SELESAI" ? new Date("2026-10-27T04:30:00.000Z") : null,
    })
    .returning();

  const [fact] = await db
    .insert(reportFactVersions)
    .values({
      reportId: rep.id,
      versionNo: 1,
      category: params.category,
      sizeClass: params.sizeClass,
      sizeLengthCm: String(params.lengthCm),
      sizeWidthCm: String(params.widthCm),
      sizeDepthCm: String(params.depthCm),
      landmark: params.landmark,
      observedAt: new Date(observedIso),
      impactTags: ["MEMBAHAYAKAN_RODA_DUA", "MENIMBULKAN_MACET"],
      freeText: params.freeText,
      lat: String(params.lat),
      lng: String(params.lng),
      gpsAccuracyM: params.locationSource === "MANUAL_PIN" ? "42.00" : "8.40",
      photoIds: [`photo_${params.ticketCode}`],
      factsHash,
      createdByActor: reporterRow.pseudonymId,
    })
    .returning();

  const [draft] = await db
    .insert(reportDrafts)
    .values({
      reportId: rep.id,
      factsVersionId: fact.id,
      sourceType: params.draftSource,
      title: params.title,
      body: params.body,
      modelName: params.draftSource === "AI" ? "gpt-6-luna" : null,
      reasoningEffort: params.draftSource === "AI" ? "medium" : null,
      promptVersion: "v1.0-mia2026",
      validatorResult: { passed: true, checkedNumbers: [], violations: [] },
      latencyMs: 1840,
      factsHash,
      isStale: false,
    })
    .returning();

  await db.insert(reportApprovals).values({
    reportId: rep.id,
    draftId: draft.id,
    approvedFactsHash: factsHash,
    isValid: true,
  });

  await db
    .update(reports)
    .set({
      currentFactsVersionId: fact.id,
      approvedDraftId: draft.id,
    })
    .where(eq(reports.id, rep.id));

  for (const idx of params.tags.keys()) {
    await db
      .insert(reportConditionTags)
      .values({
        reportId: rep.id,
        tagCode: params.tags[idx],
        voterKey: `seed_voter_${idx}`,
        verifiedEmailHash: "seed_email_hash",
      })
      .onConflictDoNothing();
  }

  await appendAuditLog({
    reportId: rep.id,
    actorId: reporterRow.pseudonymId,
    actorType: "WARGA_PSEUDONIM",
    actionType: "REPORT_SUBMITTED",
    snapshotBefore: { status: "DRAFT" },
    snapshotAfter: {
      status: params.status,
      ticketCode: params.ticketCode,
      factsHash,
    },
  });
}

async function main() {
  console.log("🌱 [SIJAGO SEED] Memulai inisialisasi ekstensi, trigger, & data master Kota Bogor...");

  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "postgis";`);

  await db.execute(sql`
    CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'SIJAGO SECURITY VIOLATION: Tabel report_audit_logs bersifat append-only dan tidak dapat diubah atau dihapus.';
    END;
    $$ LANGUAGE plpgsql;
  `);

  await db.execute(sql`
    DROP TRIGGER IF EXISTS trg_protect_report_audit_logs ON report_audit_logs;
    CREATE TRIGGER trg_protect_report_audit_logs
    BEFORE UPDATE OR DELETE ON report_audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_modification();
  `);

  await db
    .insert(agencies)
    .values([
      {
        code: "PUPR_KOTA_BOGOR",
        name: "Dinas PUPR Kota Bogor (Simulasi)",
        level: "KOTA",
        officialEmails: ["pupr.kotabogor@sijago.simulasi.id"],
        jurisdictionNote: "Berwenang atas seluruh ruas jalan berstatus Jalan Kota di 6 Kecamatan Kota Bogor.",
        isActive: true,
      },
      {
        code: "BINAMARGA_JABAR",
        name: "Dinas Bina Marga & Penataan Ruang Pemprov Jabar (Simulasi)",
        level: "PROVINSI",
        officialEmails: ["binamarga.jabar@sijago.simulasi.id"],
        jurisdictionNote: "Berwenang atas ruas Jalan Provinsi yang melintasi Kota Bogor.",
        isActive: true,
      },
      {
        code: "BBPJN_NASIONAL",
        name: "Balai Besar Pelaksanaan Jalan Nasional DKI Jakarta - Jawa Barat (Simulasi)",
        level: "NASIONAL",
        officialEmails: ["bbpjn.nasional@sijago.simulasi.id"],
        jurisdictionNote: "Berwenang atas ruas Jalan Nasional (misal: Jl. Raya Pajajaran / Jl. Raya Tajur).",
        isActive: true,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(systemConfig)
    .values([
      {
        key: "duplicate_radius_meters",
        value: 30,
        description: "Radius (meter) deteksi laporan kandidat duplikat di sekitar titik GPS.",
      },
      {
        key: "ai_timeout_ms",
        value: 9000,
        description: "Batas waktu panggilan OpenAI gpt-6-luna sebelum fallback ke Draf Template.",
      },
      {
        key: "ai_max_regenerate_per_report",
        value: 5,
        description: "Batas maksimal warga menekan Buat Ulang Draf AI per laporan.",
      },
      {
        key: "signoff_monitoring_days",
        value: 30,
        description: "Durasi masa pemantauan Community Sign-Off setelah status Selesai.",
      },
      {
        key: "signoff_reopen_min_votes",
        value: 3,
        description: "Jumlah suara minimum untuk membuka kembali laporan yang dinilai Cepat Rusak.",
      },
      {
        key: "signoff_reopen_bad_ratio",
        value: 0.5,
        description: "Proporsi suara Cepat Rusak (> 50%) untuk mengubah status menjadi DIBUKA_KEMBALI.",
      },
      {
        key: "red_zone_rainfall_threshold_mm",
        value: 50,
        description: "Ambang curah hujan (mm) untuk klasifikasi Zona Merah Weather-Road Intelligence.",
      },
    ])
    .onConflictDoNothing();

  // Seed 3 sampel laporan utama Kota Bogor
  await seedSampleReport({
    ticketCode: "SJG-2026-1042",
    trackingToken: "trk_demo_1042",
    status: "SELESAI",
    category: "LUBANG",
    sizeClass: "SEDANG",
    lengthCm: 80,
    widthCm: 60,
    depthCm: 12,
    districtName: "Bogor Tengah",
    subdistrictName: "Paledang",
    landmark: "Depan Pintu 1 Kebun Raya Bogor, Jl. Ir. H. Juanda lajur kiri arah BTM",
    suggestedStreetName: "Jl. Ir. H. Juanda, Paledang, Bogor Tengah, Kota Bogor",
    lat: -6.597147,
    lng: 106.806039,
    locationSource: "GPS",
    draftSource: "AI",
    title: "Lubang Jalan Berukuran 80x60x12 cm di Depan Pintu 1 Kebun Raya Bogor",
    body: "Dilaporkan kerusakan jalan kategori lubang berukuran panjang 80 cm, lebar 60 cm, dan kedalaman 12 cm (kelas sedang) dengan patokan di depan gerbang masuk Kebun Raya Bogor Pintu 1, lajur kiri arah BTM. Kondisi lubang sering tertutup genangan air saat hujan sore sehingga membahayakan pengendara roda dua dan memicu perlambatan arus lalu lintas.",
    freeText:
      "Lubang cukup dalam dan sering tertutup genangan air saat hujan sore, kemarin ada pemotor hampir jatuh.",
    upvotes: 24,
    priorityScore: "89.50",
    agencyCode: "PUPR_KOTA_BOGOR",
    isRecurrentHotspot: true,
    tags: ["TERTUTUP_GENANGAN_AIR", "RAWAN_PEMOTOR_JATUH"],
  });

  await seedSampleReport({
    ticketCode: "SJG-2026-1045",
    trackingToken: "trk_demo_1045",
    status: "DITERUSKAN",
    category: "AMBLAS",
    sizeClass: "BESAR",
    lengthCm: 150,
    widthCm: 90,
    depthCm: 18,
    districtName: "Tanah Sareal",
    subdistrictName: "Kedungbadak",
    landmark: "100 meter sebelum u-turn Lotte Grosir Jl. Sholeh Iskandar arah Yasmin",
    suggestedStreetName: "Jl. KH. Sholeh Iskandar, Tanah Sareal, Kota Bogor",
    lat: -6.5612,
    lng: 106.7815,
    locationSource: "GPS",
    draftSource: "AI",
    title: "Jalan Amblas dan Drainase Meluap di Jl. Sholeh Iskandar Arah Yasmin",
    body: "Dilaporkan kerusakan permukaan jalan kategori amblas berukuran besar (panjang 150 cm, lebar 90 cm, kedalaman 18 cm) di dekat putaran balik Lotte Grosir Jl. Sholeh Iskandar. Saluran drainase tepi jalan tersumbat saat hujan deras sehingga genangan menutup badan jalan.",
    freeText: "Saluran drainase tersumbat sehingga saat hujan deras jalan amblas tertutup air.",
    upvotes: 31,
    priorityScore: "94.00",
    agencyCode: "BBPJN_NASIONAL",
    isRecurrentHotspot: true,
    tags: ["TERTUTUP_GENANGAN_AIR", "MINIM_PENERANGAN"],
  });

  await seedSampleReport({
    ticketCode: "SJG-2026-1049",
    trackingToken: "trk_demo_1049",
    status: "MENUNGGU_VERIFIKASI",
    category: "RETAK",
    sizeClass: "SEDANG",
    lengthCm: 120,
    widthCm: 40,
    depthCm: 5,
    districtName: "Bogor Timur",
    subdistrictName: "Sukasari",
    landmark: "Depan Pasar Sukasari Jl. Siliwangi",
    suggestedStreetName: "Jl. Siliwangi, Bogor Timur, Kota Bogor",
    lat: -6.6152,
    lng: 106.8142,
    locationSource: "MANUAL_PIN",
    draftSource: "TEMPLATE",
    title: "[RETAK - SEDANG] Kerusakan Jalan di Depan Pasar Sukasari Jl. Siliwangi",
    body: "Dilaporkan kerusakan jalan kategori retak dengan kelas ukuran sedang (panjang 120 cm, lebar 40 cm). Patokan lokasi berada di depan area pemberhentian angkot Pasar Sukasari, Jl. Siliwangi. Kondisi ini berdampak pada mengganggu kenyamanan pengguna jalan.",
    freeText: "Retakan memanjang di jalur angkot berhenti depan Pasar Sukasari.",
    upvotes: 4,
    priorityScore: "52.00",
    agencyCode: null,
    isRecurrentHotspot: false,
    tags: [],
  });

  console.log("🌦️ [SIJAGO SEED] Menyinkronkan data curah hujan Open-Meteo & Zona Merah Kota Bogor...");
  await syncBogorWeatherAndHotspots();

  console.log("✅ [SIJAGO SEED] Selesai!");
  await pool.end();
}

main().catch((err) => {
  console.error("❌ [SIJAGO SEED] Gagal:", err);
  process.exit(1);
});
