# Ringkasan laporan untuk petugas

Tersedia pada laporan instansi dan moderasi admin. Tombol **Buat ringkasan** tidak berjalan otomatis. Fakta inti (kategori, kelas ukuran, patokan, waktu, dampak bila ada) diambil langsung dari versi Fakta Asal aktif. Deskripsi/draf asli tetap tersedia dan dapat dibuka lewat **Baca Fakta Asal lengkap**.

## Model dan biaya pemrosesan

- `AI_SUMMARY_ENABLED=true` (default).
- `OPENAI_SUMMARY_MODEL`: opsional, memakai `OPENAI_MODEL` bila kosong; memerlukan teks dan Structured Outputs JSON Schema.
- `OPENAI_API_KEY` di backend; timeout memakai `AI_PHOTO_TIMEOUT_MS`, tanpa retry otomatis.
- Tidak ada foto dikirim untuk ringkasan. Model hanya menerima bagian keterangan warga (maksimal 1000 karakter sebelum pemisahan) yang telah disamarkan pola email, nomor kontak dan URL-nya. Penyaringan pola tidak menjamin semua identitas di teks bebas dapat dikenali.
- Model hanya memilih maksimal 3 indeks kutipan sumber. Server menolak indeks asing, duplikat, jumlah berlebih, respons tidak lengkap, serta teks hasil karangan. Fakta inti tidak ditulis ulang oleh AI. Kata yang sangat panjang dibatasi dan diberi elipsis agar tampilan aman.
- Output model maksimal 256 token; reasoning low pada GPT-5/6. Keterangan maksimal 320 karakter, paling banyak dua bagian, atau tidak ada keterangan, diproses langsung tanpa AI.
- Cache pilihan valid 10 menit, maksimal 100 entri per proses, key memuat model, versi prompt dan seluruh potongan teks. Permintaan identik bersamaan berbagi panggilan. Fakta/status serta hak akses tetap dibaca ulang; tidak ada kolom privat/cookie/token dalam respons.

Ringkasan ini bersifat ekstraktif: memilih bagian penting, bukan membuat paragraf baru atau menyimpulkan penyebab, prioritas, keputusan instansi atau status. Kutipan yang dipilih tetap bisa kehilangan konteks; antarmuka meminta petugas membaca sumber lengkap. Model tidak mengubah laporan, draf, status, penugasan, atau mengirim pesan/email.

## Fallback dan akses

Saat model gagal, respons tidak valid, kuota habis, kunci tidak valid, atau AI dinonaktifkan, tampilkan **Ringkasan dasar dari Fakta Asal** dengan pemberitahuan. Untuk teks panjang, fallback hanya menampilkan dua bagian awal, bukan mengklaim hasil ringkasan AI. Kegagalan provider tidak di-cache sebagai keberhasilan AI. Laporan lama tanpa versi Fakta Asal tidak direkonstruksi dari draf; petugas tetap membaca draf/deskripsi aslinya.

ADMIN/SUPER_ADMIN dapat membaca ringkasan melalui rute admin. PETUGAS_INSTANSI hanya melalui rute instansi untuk laporan yang masih ditugaskan kepadanya dan belum dikembalikan. Warga/AUDITOR tidak mendapat akses. Hak akses diperiksa sebelum cache dan setelah pemrosesan; pergantian fakta, status atau updated_at menolak respons usang dengan 409.

## API

`POST /v1/admin/reports/:id/summary` atau `POST /v1/agency/reports/:id/summary`, body `{}`. Sesi portal masing-masing dan origin terpercaya diperlukan. Rate limit 10 respons berhasil per akun/15 menit serta 30 percobaan/akun/menit. Respons dasar dan cache tetap dihitung sebagai pemuatan ringkasan. Pembatas/cache masih berada dalam memori proses.

Respons berisi reportId, ticketCode, status, method (`AI_EXTRACTIVE`/`BASIC`), cached, notice, fields (label/value dari Fakta Asal), highlights (kutipan), checkedAt, factsUpdatedAt. Tidak menerima prompt atau fakta dari browser. Tidak ada migrasi database; deploy frontend dan backend bersama.

Validasi: `npm run typecheck`, `npx tsx tests/report-summary-selection.test.ts` (provider tiruan), `npx tsx tests/report-summary.test.ts` (fixture database selalu di-rollback; provider tiruan). Pengujian browser admin/instansi pada desktop/mobile mencakup tombol eksplisit, label AI vs dasar, tautan sumber, error dan pembuangan respons lama. Tidak ada panggilan OpenAI berbayar dalam validasi ini.
