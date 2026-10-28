import { sql } from "drizzle-orm";
import { db, pool } from "./index.js";

/**
 * Mengaktifkan ekstensi wajib `pgcrypto` dan `postgis` di Neon PostgreSQL
 * sebelum menjalankan `drizzle-kit push`.
 */
async function initExtensions() {
  console.log("🔧 [SIJAGO DB] Mengaktifkan ekstensi pgcrypto dan postgis di Neon PostgreSQL...");
  await db.execute(sql.raw(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`));
  await db.execute(sql.raw(`CREATE EXTENSION IF NOT EXISTS "postgis";`));
  console.log("✅ [SIJAGO DB] Ekstensi pgcrypto dan postgis aktif!");
  await pool.end();
}

initExtensions().catch((err) => {
  console.error("❌ [SIJAGO DB] Gagal mengaktifkan ekstensi:", err);
  process.exit(1);
});
