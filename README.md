# SIJAGO Backend — Sistem Jalan Bogor REST API

Backend layanan **SIJAGO (Sistem Jalan Bogor)** untuk kompetisi **MIA2026**. Dibangun menggunakan **Node.js, Express.js, TypeScript, Drizzle ORM, dan PostgreSQL (Neon) + PostGIS**, dilengkapi layanan asisten AI terjaga (*guarded AI*), geospasial koridor jalan, intelijen cuaca-jalan (*Weather-Road Intelligence*), serta log audit berantai (*tamper-evident hash chain*).

## Deployment

- **BE (Render):** [sijago-backend.onrender.com](https://sijago-backend.onrender.com)
- **FE (Vercel):** [sijago-frontend.vercel.app](https://sijago-frontend.vercel.app/)

## Tech Stack

| Komponen | Teknologi |
| --- | --- |
| Runtime & Framework | Node.js 22, Express.js, TypeScript (`tsx`) |
| Database & Geospasial | PostgreSQL (Neon), PostGIS (`geography`), `pgcrypto`, Drizzle ORM |
| AI & Moderasi Visual | OpenAI API (`omni-moderation-latest` & model Vision/Text dengan JSON Schema ketat) |
| Penyimpanan Objek Foto | Cloudinary (transformasi publik tanpa profil EXIF & pembatasan ukuran) |
| Transaksi Email | Resend (tanda terima tiket, OTP pemulihan tiket, dan eskalasi instansi) |
| Data Cuaca & Geokoding | Open-Meteo, BMKG Open Data, NASA POWER, OpenStreetMap Nominatim |
| Keamanan & Autentikasi | Sesi PostgreSQL (`HttpOnly` cookie), `bcrypt` (`pgcrypto`), Cloudflare Turnstile, Helmet, Express Rate Limit |

## Fitur Utama Backend

### 1. Pelaporan Warga Tanpa Login (Pseudonim) & Draf Deterministik
- Warga dapat melapor tanpa registrasi akun menggunakan identitas pseudonim (`warga_<hash>`) dan perlindungan anti-bot Cloudflare Turnstile.
- Deteksi laporan berdekatan menggunakan kueri spasial PostGIS (`ST_DWithin` & `ST_Distance`) agar warga dapat langsung mendukung (*upvote*) laporan yang sudah ada di titik yang sama.
- Penyusunan draf laporan warga menggunakan **Template Deterministik** (`buildDeterministicTemplateDraft`) dan penguncian integritas fakta berbasis hash SHA-256 (`factsHash`).
- Pemulihan kode tiket melalui OTP ke alamat email pelapor (disimpan terenkripsi/ter-hash untuk menjaga privasi).

### 2. Empat Fitur AI Terjaga (*Guarded AI Services*)
Seluruh fitur AI menerapkan validasi skema ketat (`zod` + OpenAI Structured Outputs `json_schema`), penyamaran data pribadi (PII redaction), *bounded single-flight cache*, dan *fallback* aman apabila layanan eksternal sedang tidak tersedia:
1. **AI Photo Safety & Road Relevance Gate (`src/services/photoSafety.service.ts`)**
   - Memeriksa setiap foto laporan melalui OpenAI Moderation (`omni-moderation-latest`) untuk memblokir konten sensitif/tidak pantas (`PHOTO_UNSAFE`).
   - Memvalidasi relevansi visual menggunakan Vision AI untuk memastikan foto benar-benar memperlihatkan kondisi jalan/genangan dan menolak foto wajah/orang, dokumen, meme, atau tangkapan layar (`PHOTO_NOT_RELEVANT`).
2. **AI Damage Photo Analysis (`POST /v1/ai/analyze-photo`, `src/services/photoAnalysis.service.ts`)**
   - Menganalisis foto kerusakan jalan dan menyarankan **Kategori Kerusakan**, **Kelas Ukuran** (hanya jika ada pembanding skala yang jelas), **Deskripsi Kondisi**, serta **Catatan Ketidakpastian** untuk ditinjau warga sebelum mengirim laporan.
3. **AI Duplicate Report Comparison (`GET /v1/admin/reports/:id/duplicate-suggestions`, `src/services/duplicateSuggestions.service.ts`)**
   - Membantu Admin Moderasi membandingkan laporan sumber dengan maksimal 3 kandidat laporan aktif dalam radius **100 meter** (PostGIS) berdasarkan foto bukti, kategori, jarak, dan waktu, menghasilkan klasifikasi `LIKELY`, `POSSIBLE`, atau `DIFFERENT` beserta alasannya.
4. **AI Agency Queue Pattern Summarizer (`POST /v1/agency/reports/summary`, `src/services/reportSummary.service.ts`)**
   - Membantu Petugas Instansi merangkum maksimal 5 pola keluhan/kondisi bersama dari antrean laporan yang ditugaskan ke instansinya (baik mode filter maupun laporan terpilih), lengkap dengan sitasi ID laporan sumber yang tervalidasi.

### 3. Moderasi Admin, Eskalasi Multi-Instansi & Community Sign-Off
- Alur siklus hidup laporan: `MENUNGGU_VERIFIKASI` → `TERVERIFIKASI` → `DITERUSKAN` → `DIPROSES` → `SELESAI` → `DITUTUP` (serta `DITOLAK`, `DIGABUNGKAN`, atau `DIBUKA_KEMBALI`).
- Pembagian kewenangan jalan ke 3 instansi:
  - **Dinas PUPR Kota Bogor** (`PUPR_KOTA_BOGOR`) — Jalan Kota
  - **Dinas Bina Marga dan Penataan Ruang (DBMPR) Provinsi Jawa Barat** (`BINAMARGA_JABAR`) — Jalan Provinsi
  - **BBPJN DKI Jakarta–Jawa Barat** (`BBPJN_NASIONAL`) — Jalan Nasional
- Masa pemantauan komunitas 30 hari (*Community Sign-Off*) setelah instansi menandai laporan `SELESAI`, memungkinkan warga menyanggah dengan bukti foto baru jika perbaikan kembali rusak.

### 4. Tamper-Evident Audit Log
- Setiap perubahan status, verifikasi, penggabungan duplikat, dan eskalasi dicatat ke tabel `report_audit_logs` dengan rantai hash SHA-256 (`prev_hash` → `curr_hash`) dan dilindungi trigger PostgreSQL `trg_protect_report_audit_logs` yang menolak operasi `UPDATE` maupun `DELETE`.

---

## Cara Menjalankan Backend

### 1. Instalasi & Konfigurasi Environment

```powershell
cd sijago-backend
npm install
Copy-Item .env.example .env
```

Isi variabel penting pada file `.env`:
- `DATABASE_URL`: connection string PostgreSQL/Neon (wajib mendukung ekstensi `postgis` dan `pgcrypto`).
- `PORT=4000` dan `FRONTEND_URL=http://localhost:3000`.
- `JWT_SECRET` dan `PSEUDONYM_HASH_SALT`: string acak rahasia minimal 32 karakter.
- `OPENAI_API_KEY`: API key OpenAI untuk mengaktifkan ke-4 fitur AI.
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`: kredensial penyimpanan foto laporan.
- `RESEND_API_KEY` dan `RESEND_FROM_EMAIL`: kredensial pengiriman email tanda terima tiket, OTP, dan eskalasi instansi.

### 2. Urutan Reset Database, Migrasi, dan Seeding

Jalankan perintah berikut secara berurutan dari folder `sijago-backend`:

```powershell
# 1. (Opsional) Reset seluruh tabel database ke kondisi kosong
npm run db:reset

# 2. Jalankan migrasi tabel, indeks spasial PostGIS, dan trigger audit
npm run db:migrate

# 3. Seed data master (3 instansi kewenangan jalan, konfigurasi sistem, trigger audit)
npm run db:seed

# 4. Seed 4 akun portal demo (1 Admin + 3 Instansi)
npm run db:seed:accounts

# 5. Seed 11 laporan contoh (SJG-2026-4101 s.d. SJG-2026-4111) menggunakan gambar dari frontend
npm run db:seed:reports

# 6. Jalankan server development (http://localhost:4000/v1)
npm run dev
```

---

## Daftar Akun Demo Hasil `npm run db:seed:accounts`

| Peran | Instansi | Email | Kata Sandi |
| --- | --- | --- | --- |
| `ADMIN` | Administrator SIJAGO | `admin@sijago.com` | `ADMINSIJAGO123` |
| `PETUGAS_INSTANSI` | Dinas PUPR Kota Bogor (`PUPR_KOTA_BOGOR`) | `dpupr@kotabogor.go.id` | `PUPRKOTABOGOR123` |
| `PETUGAS_INSTANSI` | DBMPR Provinsi Jawa Barat (`BINAMARGA_JABAR`) | `dbmpr@jabarprov.go.id` | `DBMPR123` |
| `PETUGAS_INSTANSI` | BBPJN DKI Jakarta–Jawa Barat (`BBPJN_NASIONAL`) | `bbpjn_jktjabar@pu.go.id` | `BBPJN123` |

## Data Laporan Contoh Hasil `npm run db:seed:reports`

Skrip `src/db/seed-reports.ts` menghasilkan **11 laporan contoh** dengan kode tiket asli (`SJG-2026-4101` s.d. `SJG-2026-4111`) menggunakan foto dari `../sijago-frontend/public/images/example/`:
- **Klaster 3 Laporan Berdekatan (~12 meter di Jl. Ir. H. Juanda / Pintu 1 Kebun Raya Bogor)** untuk pengujian deteksi laporan sekitar dan perbandingan duplikat AI:
  - `SJG-2026-4101` (`lubang_jalan_1.jpg` — `LUBANG`, `BESAR`, `MENUNGGU_VERIFIKASI`)
  - `SJG-2026-4102` (`lubang_jalan_2.jpg` — `LUBANG`, `SEDANG`, `TERVERIFIKASI`)
  - `SJG-2026-4103` (`genangan_air_1.jpg` — `GENANGAN_DRAINASE`, `SEDANG`, `DITERUSKAN` ke PUPR Kota Bogor)
- **8 Laporan Lainnya (`SJG-2026-4104` s.d. `SJG-2026-4111`)** tersebar di 6 kecamatan Kota Bogor mencakup kategori `AMBLAS`, `BERGELOMBANG`, `RETAK`, dan `GENANGAN_DRAINASE` pada ketiga instansi kewenangan jalan.

---

## Daftar Script NPM

| Perintah | Deskripsi |
| --- | --- |
| `npm run dev` | Menjalankan server backend dalam mode *watch* (`http://localhost:4000/v1`) |
| `npm run build` | Mengompilasi TypeScript ke folder `dist/` |
| `npm run start` | Menjalankan hasil build produksi dari `dist/index.js` |
| `npm run typecheck` | Memeriksa tipe TypeScript tanpa menghasilkan file output (`tsc --noEmit`) |
| `npm run db:reset` | Menghapus seluruh isi tabel database untuk memulai ulang dari awal |
| `npm run db:migrate` | Menjalankan migrasi skema database, ekstensi PostGIS, dan indeks |
| `npm run db:seed` | Mengisi data master instansi, pengaturan sistem, dan trigger proteksi audit |
| `npm run db:seed:accounts` | Membuat 4 akun demo portal (Admin, PUPR Kota Bogor, DBMPR Jabar, BBPJN) |
| `npm run db:seed:reports` | Membuat 11 laporan contoh (`SJG-2026-4101` – `SJG-2026-4111`) dengan gambar contoh |
| `npm run test:ai` | Menjalankan 9 suite unit test fitur AI & keamanan foto (tanpa kuota API) |
| `npm run test:ai:live` | Menjalankan *live smoke test* ke OpenAI API (aktifkan dengan `AI_LIVE_SMOKE=true`) |

## Pengujian Fitur AI

```powershell
# Unit test seluruh guardrail & skema AI (offline / mocked)
npm run test:ai

# Live smoke test langsung ke OpenAI API
$env:AI_LIVE_SMOKE="true"; npm run test:ai:live
```

## Struktur Direktori

```text
sijago-backend/
├── sql/                  # Skrip SQL manual & dokumentasi operasional fitur
├── src/
│   ├── config/           # Validasi environment variables (env.ts)
│   ├── db/               # Koneksi database, skema Drizzle, migrasi, reset, dan seeding
│   ├── services/         # Logika bisnis (laporan, moderasi, auth, AI, cuaca, audit, email)
│   ├── utils/            # Fungsi utilitas hashing & kanonikalisasi fakta
│   └── index.ts          # Entry point Express.js & definisi route REST API (/v1)
└── tests/                # Suite pengujian otomatis fitur AI, penyimpanan foto, dan moderasi
```

## Contributors

- **Sabira Putri Cahyani**
- **Muhammad Boby Pratama**
