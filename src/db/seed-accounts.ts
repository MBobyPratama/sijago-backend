import { eq, sql } from "drizzle-orm";
import { db, pool } from "./index.js";
import { agencies, users } from "./schema.js";

export interface PortalSeedAccount {
  email: string;
  fullName: string;
  password: string;
  role: "ADMIN" | "PETUGAS_INSTANSI";
  agencyCode: "PUPR_KOTA_BOGOR" | "BINAMARGA_JABAR" | "BBPJN_NASIONAL" | null;
}

export const PORTAL_DEMO_ACCOUNTS: PortalSeedAccount[] = [
  {
    email: "admin@sijago.com",
    fullName: "Administrator SIJAGO",
    password: "ADMINSIJAGO123",
    role: "ADMIN",
    agencyCode: null,
  },
  {
    email: "dpupr@kotabogor.go.id",
    fullName: "Petugas PUPR Kota Bogor",
    password: "PUPRKOTABOGOR123",
    role: "PETUGAS_INSTANSI",
    agencyCode: "PUPR_KOTA_BOGOR",
  },
  {
    email: "dbmpr@jabarprov.go.id",
    fullName: "Petugas DBMPR Provinsi Jawa Barat",
    password: "DBMPR123",
    role: "PETUGAS_INSTANSI",
    agencyCode: "BINAMARGA_JABAR",
  },
  {
    email: "bbpjn_jktjabar@pu.go.id",
    fullName: "Petugas BBPJN DKI Jakarta–Jawa Barat",
    password: "BBPJN123",
    role: "PETUGAS_INSTANSI",
    agencyCode: "BBPJN_NASIONAL",
  },
];

async function main() {
  console.log("🔑 [SIJAGO SEED ACCOUNTS] Menyiapkan ekstensi pgcrypto, instansi, dan 4 akun portal...");

  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  // Pastikan 3 instansi utama tersedia dan aktif agar akun PETUGAS_INSTANSI dapat login
  await db
    .insert(agencies)
    .values([
      {
        code: "PUPR_KOTA_BOGOR",
        name: "Dinas PUPR Kota Bogor",
        level: "KOTA",
        officialEmails: [],
        jurisdictionNote:
          "Berwenang atas seluruh ruas jalan berstatus Jalan Kota di 6 Kecamatan Kota Bogor.",
        isActive: true,
      },
      {
        code: "BINAMARGA_JABAR",
        name: "Dinas Bina Marga dan Penataan Ruang (DBMPR) Provinsi Jawa Barat",
        level: "PROVINSI",
        officialEmails: [],
        jurisdictionNote: "Berwenang atas ruas Jalan Provinsi yang melintasi Kota Bogor.",
        isActive: true,
      },
      {
        code: "BBPJN_NASIONAL",
        name: "BBPJN DKI Jakarta–Jawa Barat",
        level: "NASIONAL",
        officialEmails: [],
        jurisdictionNote:
          "Berwenang atas ruas Jalan Nasional (misal: Jl. Raya Pajajaran / Jl. Raya Tajur).",
        isActive: true,
      },
    ])
    .onConflictDoNothing();

  await db.execute(sql`
    UPDATE public.agencies
    SET is_active = true
    WHERE code IN ('PUPR_KOTA_BOGOR', 'BINAMARGA_JABAR', 'BBPJN_NASIONAL');
  `);

  const agencyRows = await db.select().from(agencies);
  const agencyByCode = new Map(agencyRows.map((a) => [a.code, a]));

  for (const acc of PORTAL_DEMO_ACCOUNTS) {
    const normalizedEmail = acc.email.trim().toLowerCase();
    const agencyId = acc.agencyCode ? (agencyByCode.get(acc.agencyCode)?.id ?? null) : null;

    if (acc.role === "PETUGAS_INSTANSI" && !agencyId) {
      throw new Error(`Instansi dengan kode ${acc.agencyCode} tidak ditemukan di tabel agencies.`);
    }

    const hashRes = await db.execute<{ hash: string }>(
      sql`SELECT crypt(${acc.password}, gen_salt('bf', 12)) AS hash`
    );
    const passwordHash = hashRes.rows[0]?.hash;
    if (!passwordHash) {
      throw new Error(`Gagal membuat bcrypt hash untuk ${normalizedEmail}`);
    }

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${normalizedEmail}`)
      .limit(1);

    if (existing) {
      await db
        .update(users)
        .set({
          email: normalizedEmail,
          fullName: acc.fullName,
          passwordHash,
          role: acc.role,
          agencyId,
          isActive: true,
          mfaEnabled: false,
        })
        .where(eq(users.id, existing.id));
      console.log(`✅ Diperbarui: ${normalizedEmail} (${acc.role}${acc.agencyCode ? ` • ${acc.agencyCode}` : ""})`);
    } else {
      await db.insert(users).values({
        email: normalizedEmail,
        fullName: acc.fullName,
        passwordHash,
        role: acc.role,
        agencyId,
        isActive: true,
        mfaEnabled: false,
      });
      console.log(`✅ Dibuat: ${normalizedEmail} (${acc.role}${acc.agencyCode ? ` • ${acc.agencyCode}` : ""})`);
    }
  }

  console.log("🎉 [SIJAGO SEED ACCOUNTS] Seluruh 4 akun portal siap digunakan!");
}

main()
  .catch((error) => {
    console.error("❌ [SIJAGO SEED ACCOUNTS] Gagal:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
