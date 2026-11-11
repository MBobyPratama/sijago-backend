# Ringkasan antrean instansi

Fitur hanya tersedia untuk PETUGAS_INSTANSI. Ringkasan satu laporan dihapus. Analisis cuaca tetap deterministik, tanpa AI.

## Cakupan dan tampilan

Petugas menekan **Ringkas antrean** dengan cakupan **Hasil filter saat ini** (pencarian tiket/judul/kecamatan, status, urutan) atau **Laporan yang dicentang** (1–25 ID unik). Pilihan checkbox tetap tersimpan saat filter berubah; jumlah pilihan ditampilkan. Penggantian instansi menghapus pilihan.

Backend mencari seluruh hasil filter milik instansi, bukan hanya 50 laporan yang dimuat daftar frontend. Maksimal 25 laporan pertama menurut urutan prioritas/kode tiket disertakan. Jumlah cocok, jumlah disertakan, peringatan cakupan terpotong, waktu snapshot dan seluruh tiket sumber ditampilkan. Statistik hanya mewakili laporan yang disertakan. Pilihan di luar penugasan atau yang sudah dikembalikan ditolak, bukan dilewati diam-diam.

## Statistik dan AI

Jumlah status, wilayah dan kategori dihitung backend dari database. AI menerima hanya ID dan keterangan Fakta Asal aktif yang disamarkan pola kontak/email/URL-nya, maksimal 600 karakter/laporan. Pola penyamaran tidak menjamin semua identitas bebas terdeteksi. Tidak ada foto, email pelapor, token, catatan internal, atau data cuaca dalam prompt.

AI merangkum maksimal lima pola kondisi/dampak/kendala, masing-masing didukung minimal dua tiket. Backend memvalidasi schema, batas panjang, jumlah dan ID sumber. Rujukan tidak menjamin seluruh klaim AI benar; petugas harus membaca laporan sumber. AI dilarang menentukan sebab, prioritas resmi, rekomendasi teknis atau menyatakan duplikasi. Jika tidak ada pola, tampilkan penjelasan; jika provider gagal/dinonaktifkan atau keterangan tersedia kurang dari dua laporan, statistik tetap tampil dengan label dasar tanpa rangkuman AI.

`AI_SUMMARY_ENABLED` (default true), `OPENAI_SUMMARY_MODEL` (fallback `OPENAI_MODEL`), `OPENAI_API_KEY`, timeout `AI_PHOTO_TIMEOUT_MS`. Keluaran maksimal 1200 token, reasoning low untuk model GPT-5/6, store false, tanpa retry otomatis. Cache pola 10 menit, maksimal 100 entri per proses, mencakup instansi/model/keterangan; permintaan bersamaan berbagi pemrosesan. Statistik dan hak akses tetap dibaca ulang. Rate limit 10 respons berhasil/akun/15 menit dan 30 percobaan/akun/menit, termasuk respons dasar/cache. Belum memakai penyimpanan rate limit terdistribusi.

## API

`POST /v1/agency/queue-summary`, sesi petugas instansi dan origin terpercaya. Body:

```json
{"mode":"FILTER","query":"","status":"ALL","sort":"PRIORITY"}
```

atau `{"mode":"SELECTED","reportIds":["UUID","UUID"],"sort":"PRIORITY"}`. Status: ALL, DITERUSKAN, DIPROSES, SELESAI, DIBUKA_KEMBALI, DITUTUP. Urutan: PRIORITY atau TICKET. Instansi selalu ditentukan dari sesi.

Respons: total, included, truncated, method (AI/BASIC), cached, notice, stats (status/district/category), patterns (text/reportIds), sources (id/ticketCode/title/status), missingConditions, checkedAt. 400: cakupan invalid/kosong; 403: bukan petugas/akses di luar penugasan; 409: laporan sumber berubah selama pemrosesan. Perubahan filter/instansi di UI membatalkan permintaan dan menghapus hasil sebelumnya. Tidak mengubah laporan, status, audit, atau mengirim email. Endpoint ringkasan per laporan sudah dihapus. Tidak memerlukan migrasi database.

## Validasi

TypeScript frontend/backend; tests/report-summary-selection.test.ts (schema, limit, privasi, provider tiruan); tests/report-summary.test.ts (transaksi fixture rollback: cakupan penuh 27 laporan, batas 25, statistik/filter/pilihan, cache, fallback, hak akses dan revisi usang); browser desktop/mobile dengan API tiruan. Tidak ada pemanggilan AI berbayar dalam pengujian.
