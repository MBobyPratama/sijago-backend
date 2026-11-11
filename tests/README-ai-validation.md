# Validasi fitur AI — 11 November 2026

## Menjalankan ulang

- `npm run test:ai`: sembilan suite otomatis, provider tiruan; fixture integrasi Neon selalu di-rollback. Memerlukan konfigurasi database dan akses HTTP localhost.
- `npm run typecheck` di backend; `npx tsc --noEmit` di frontend.
- Smoke test provider asli (berbiaya, opt-in): PowerShell `$env:AI_LIVE_SMOKE="true"; npm run test:ai:live`. Memakai logo publik project dan dua keterangan sintetis, tidak mengirim foto/teks warga. Tanpa flag, script melewati pengujian.

## Cakupan yang telah berhasil

1. Analisis foto: tipe/ukuran/signature gambar, output terstruktur, ukuran tidak pasti, irrelevant, kegagalan/refusal/truncation, origin dan rate limit (5 keberhasilan/15 menit; kegagalan tidak menghabiskan jatah).
2. Keamanan: konten ditolak sebelum saran, relevansi, kegagalan provider menahan proses, cache/single-flight, gambar berubah diperiksa ulang, sesudah perbaikan tetap dimoderasi tanpa syarat kerusakan.
3. Registrasi bukti: tidak ada insert bila pemeriksaan gagal; REPORT/BEFORE memerlukan relevansi, AFTER/SIGNOFF keamanan; URL browser tidak dipercaya. Pengaitan bukti ke fakta juga harus lolos pemeriksaan.
4. Penyimpanan: public ID folder terpercaya, versi asset dipatok, pratinjau AI dibatasi, URL bukti tetap resolusi penuh, SVG/multipage/ukuran/signature invalid ditolak. Cloudinary dan fetch ditiru dalam pengujian ini.
5. Duplikat: akses admin, radius 100 m, maksimal tiga kandidat aktif, foto hilang ditandai, output ID ketat, cache, tidak otomatis merge/audit. Fitur yang dimatikan menolak cache lama.
6. Ringkasan antrean: akses petugas sesuai instansi, filter seluruh antrean (fixture 27 laporan), batas 25 eksplisit, pilihan berbeda 1–25, statistik database, referensi sumber, cache, fallback, perubahan/penarikan penugasan menolak snapshot usang.
7. Browser: ketiga fitur pada 1440 dan 375 px menggunakan API tiruan; permintaan eksplisit, penerapan saran, cakupan filter/pilihan pada request, sumber, pesan error/fallback, respons usang dibuang, tanpa horizontal overflow. Harness lokal ada di frontend `.hallmark/photo-analysis`, `.hallmark/duplicate-suggestions`, `.hallmark/queue-summary` dan tidak menjadi test produksi.
8. Provider OpenAI asli: akses model berhasil; lima smoke checks berhasil — moderasi gambar aman, logo tidak relevan ditolak, output analisis logo tidak menyarankan kerusakan, pola dua laporan sintetis dengan rujukan sumber, dan schema perbandingan kandidat multimodal.

## Bug yang diperbaiki saat audit ini

- Registrasi foto sebelumnya dapat mencatat foto tanpa menjalankan pemeriksaan keamanan. Sekarang pemeriksaan server harus berhasil sebelum insert, memakai URL asset hasil pemeriksaan server.
- Respons klasifikasi relevansi sekarang divalidasi schema ketat, bukan hanya membaca properti boolean.
- Menonaktifkan analisis foto/saran duplikat sekarang juga memblokir hasil cache, bukan hanya panggilan provider baru.

## Batas bukti pengujian

Hasil ini tidak menjamin tidak ada bug pada semua input atau deployment. Smoke test gambar memakai logo, bukan kumpulan foto jalan rusak dunia nyata atau konten berbahaya; akurasi klasifikasi/duplikasi tetap memerlukan evaluasi foto berlabel. Tidak melakukan unggah Cloudinary produksi end-to-end, pengiriman email, tes beban, atau validasi konfigurasi production. Artefak Cloudinary yang ditolak belum dihapus otomatis. Pembatas/cache masih per proses; IP warga dapat berbagi kuota melalui proxy. Kehilangan layanan AI menahan registrasi foto (fail-closed); ringkasan/duplikat tetap menyediakan jalur dasar/manual.
