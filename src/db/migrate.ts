import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db, pool } from "./index.js";

async function runMigrations() {
  console.log("🚀 [SIJAGO MIGRATE] Memastikan ekstensi PostGIS & pgcrypto aktif...");
  await db.execute(sql.raw(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`));
  await db.execute(sql.raw(`CREATE EXTENSION IF NOT EXISTS "postgis";`));

  console.log("📦 [SIJAGO MIGRATE] Menjalankan migrasi SQL secara idempoten ke Neon PostgreSQL...");
  const sqlFilePath = path.resolve(process.cwd(), "drizzle/0000_safe_rattler.sql");
  const rawSql = fs.readFileSync(sqlFilePath, "utf-8");
  const statements = rawSql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    try {
      await db.execute(sql.raw(stmt));
    } catch (err: unknown) {
      const pgCode = (err as { code?: string })?.code;
      // 42710 = duplicate_object (type/constraint already exists), 42P07 = duplicate_table
      if (pgCode === "42710" || pgCode === "42P07") {
        continue;
      }
      throw err;
    }
  }

  // Indeks GIST Spasial PostGIS (FR-1.4 & FR-1.9)
  await db.execute(
    sql.raw(`CREATE INDEX IF NOT EXISTS idx_reports_location_gist ON reports USING GIST (location);`)
  );

  console.log("✅ [SIJAGO MIGRATE] Seluruh 19 tabel & indeks spasial PostGIS siap di Neon!");
  await pool.end();
}

runMigrations().catch((err) => {
  console.error("❌ [SIJAGO MIGRATE] Gagal:", err);
  process.exit(1);
});
