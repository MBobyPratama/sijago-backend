# Saran laporan duplikat

Fitur di `/admin/moderasi`: **Cari saran dengan AI** → bandingkan foto sumber/kandidat dan alasan → **Gunakan sebagai tiket induk** → tombol **Gabung** yang sudah ada → konfirmasi admin. Tidak ada analisis otomatis saat membuka halaman dan tidak ada penggabungan otomatis. Saran tidak mengubah laporan, dukungan, tag, penugasan, email, maupun audit; keputusan penggabungan tetap dicatat oleh layanan merge.

## Konfigurasi

`AI_DUPLICATE_ENABLED=true` (default), `OPENAI_API_KEY` valid, model vision/Structured Outputs dari `OPENAI_VISION_MODEL` atau `OPENAI_MODEL`, serta Cloudinary backend terkonfigurasi. Tidak ada migrasi database. Frontend/backend perlu diterapkan bersama. Tanpa AI atau jika pemeriksaan gagal, pemilihan tiket induk manual tetap tersedia.

## Batas pencarian dan kualitas

- Sumber harus aktif dan belum digabung: menunggu verifikasi, terverifikasi, diteruskan, diproses, dibuka kembali.
- Kandidat: maksimal 3 laporan aktif terdekat dalam 100 meter, memakai PostGIS. Hanya terverifikasi, diteruskan, diproses, dibuka kembali; bukan diri sendiri atau laporan yang sudah digabung. Laporan selesai/ditutup tidak dianggap kandidat untuk mengurangi risiko menyatukan episode kerusakan baru.
- Satu foto REPORT/BEFORE per laporan; foto AFTER tidak dibandingkan sebagai foto kerusakan.
- Foto diambil dari Cloudinary backend dan melewati pemeriksaan keamanan/relevansi. Kandidat tanpa foto atau gagal diperiksa dilewati dan jumlahnya diberitahukan. Jika foto sumber gagal, tidak ada saran.
- Model membandingkan foto, kategori, keterangan singkat, jarak, waktu pengamatan/pengiriman, dan status. Kedekatan GPS atau kemiripan jalan saja bukan bukti duplikat. Waktu tidak diketahui tetap ditampilkan sebagai keterbatasan.
- Hasil: LIKELY (indikasi kuat), POSSIBLE (perlu dibandingkan), DIFFERENT (tidak ditampilkan sebagai saran). Tidak ada persentase keyakinan. ID harus tepat sama dengan seluruh kandidat yang diberikan; respons tidak lengkap, ID asing, duplikat ID, atau format salah ditolak.
- Status/Fakta Asal sumber diperiksa kembali setelah provider selesai. Kandidat yang berubah tidak disarankan. Endpoint penggabungan tetap memvalidasi ulang dalam transaksi.
- Radius dan maksimum kandidat membatasi cakupan. Hasil kosong bukan jaminan bahwa laporan unik. Prediksi AI belum dievaluasi pada kumpulan foto lapangan nyata.

## Efisiensi dan privasi

Satu panggilan AI batch untuk maksimal 4 foto (1 sumber + 3 kandidat). Gambar diperkecil oleh jalur Cloudinary menjadi maksimal 768×768 tanpa EXIF, `detail: low`, reasoning low pada GPT-5/6, maksimal 900 token keluaran, alasan maksimal 220 karakter/kandidat, tanpa retry otomatis. Tidak ada kandidat berarti tidak ada panggilan AI.

Cache hasil 5 menit dengan maksimum 100 entri per proses; hash mencakup model/prompt dan bukti pembanding, termasuk isi foto, sehingga perubahan bukti menghasilkan pemeriksaan baru. Permintaan identik yang bersamaan berbagi panggilan perbandingan. Pemeriksaan keamanan foto memakai cache terpisah yang sudah ada. Kegagalan tidak di-cache sebagai hasil valid.

Nama/email pelapor, tiket/tracking token, kontak, catatan admin, koordinat GPS mentah, serta URL foto tidak dimasukkan ke prompt. Pola email/telepon/URL pada keterangan disamarkan dan teks dibatasi 400 karakter. Penyaringan pola tidak menjamin menghapus seluruh informasi pribadi dalam teks bebas atau gambar. Model dilarang menyalin identitas atau instruksi dalam foto/teks.

## API dan pembatasan

`POST /v1/admin/reports/:id/duplicate-suggestions` body `{}`. Membutuhkan sesi ADMIN/SUPER_ADMIN dan origin terpercaya. Batas 10 pemeriksaan berhasil per akun admin per 15 menit; respons gagal tidak mengurangi jatah. Hasil cache dan pencarian kosong tetap dihitung sebagai pemeriksaan. Batas ini memakai memori proses.

Respons memuat reportId, radiusMeters, candidateLimit, candidatesFound, evaluated, skipped, checkedAt, cached, sourcePhotoUrl, suggestions. Saran memuat id/ticket/title/status, jarak, kategori/keterangan/waktu pengamatan, foto kandidat, match, reason. Tidak ada base64 foto atau kolom privat laporan dalam respons.

Validasi:

- `npm run typecheck`
- `npx tsx tests/duplicate-comparison.test.ts` (provider tiruan)
- `npx tsx tests/duplicate-suggestions.test.ts` (provider/foto tiruan, fixture database selalu di-rollback)

Pembatas tambahan 20 percobaan per akun admin per menit berlaku termasuk kegagalan, untuk mencegah permintaan beruntun ke provider.
