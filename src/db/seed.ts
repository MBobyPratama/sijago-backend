import { sql } from "drizzle-orm";
import { db, pool } from "./index.js";
import { agencies, systemConfig } from "./schema.js";

/**
 * Script Seeder Awal SIJAGO Kota Bogor (MIA2026)
 * Mengaktifkan ekstensi PostGIS & pgcrypto, memasang trigger append-only audit log,
 * serta mengisi data master instansi simulasi dan system_config.
 */
async function main() {
  console.log("🌱 [SIJAGO SEED] Memulai inisialisasi ekstensi, trigger, & data master Kota Bogor...");

  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "postgis";`);

  // Trigger append-only untuk report_audit_logs (FR-7.1)
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

  // 1. Seed Instansi Simulasi (PUPR Kota Bogor, Pemprov Jabar, Balai Nasional)
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

  // 2. Seed Parameter Konfigurasi Sistem (US-20)
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

  console.log("✅ [SIJAGO SEED] Selesai!");
  await pool.end();
}

main().catch((err) => {
  console.error("❌ [SIJAGO SEED] Gagal:", err);
  process.exit(1);
});
