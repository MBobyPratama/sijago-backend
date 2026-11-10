# Catatan internal dan tanggapan publik

Sebelum deploy backend, jalankan `drizzle/0006_public_admin_response.sql` melalui SQL editor Neon atau `npm run db:migrate`. Migrasi menambahkan kolom nullable `reports.public_admin_response`; catatan lama tidak dipindahkan ke publik.

- `admin_notes` tetap untuk admin/instansi. API publik daftar dan detail tidak mengirim `adminNotes`.
- API pelacakan tidak lagi mengirim log audit mentah karena snapshot dapat memuat catatan internal. Timeline warga menggunakan tanggal perkembangan laporan; audit lengkap tetap di endpoint staf yang dilindungi autentikasi.
- Admin/Super Admin menyimpan tanggapan melalui `PUT /v1/admin/reports/:id/public-response`, dengan `{ "publicAdminResponse": "Tanggapan untuk warga" }`. Endpoint mengikuti autentikasi dan pemeriksaan origin portal admin.
- Maksimal 2.000 karakter; teks kosong menghapus tanggapan publik. Penyimpanan dan pencatatan `ADMIN_OVERRIDE` dengan operasi `PUBLIC_ADMIN_RESPONSE_UPDATED` berlangsung dalam satu transaksi.
- Tanggapan tersedia pada detail dan pelacakan warga sebagai teks biasa. HTML tidak dirender. Menyimpan tanggapan tidak mengubah fakta asli, status, atau catatan internal laporan.

Pemeriksaan: `node node_modules/tsx/dist/cli.mjs tests/public-admin-response.test.ts` dan `npm run typecheck`.
