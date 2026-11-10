# Bantuan pengisian dari foto

Fitur opsional di halaman `/lapor`: warga mengunggah foto, menekan **Analisis foto dengan AI**, meninjau saran, lalu menekan **Terapkan saran ke formulir**. Analisis dan penerapan tidak berjalan otomatis. Isian kategori, kelas ukuran, dan kondisi tetap dapat diedit warga. Penerapan mereset persetujuan draf seperti perubahan Fakta Asal lainnya. Draf akhir tetap menggunakan template.

## Konfigurasi backend

- `OPENAI_API_KEY`: kunci API di backend, jangan gunakan variabel `NEXT_PUBLIC_*`.
- `AI_PHOTO_ENABLED=true`: mengaktifkan bantuan foto, terpisah dari `AI_DRAFT_ENABLED`.
- `OPENAI_VISION_MODEL`: opsional, memakai `OPENAI_MODEL` bila kosong. Model harus mendukung input gambar dan Structured Outputs JSON Schema.
- `AI_PHOTO_TIMEOUT_MS=20000`: batas waktu satu panggilan, tanpa retry otomatis.

Tidak ada migrasi database. Frontend dan backend perlu diterapkan bersama. Tanpa kunci atau ketika provider gagal, formulir manual tetap tersedia. Pemeriksaan yang dijalankan memakai provider tiruan; akses model dan kualitas analisis foto nyata belum diverifikasi melalui panggilan berbayar.

## API dan batasan

`POST /v1/ai/analyze-photo`, body `{ "image": "data:image/jpeg;base64,..." }`. Hanya menerima data URL JPEG/PNG/WebP dengan signature file yang sesuai, maksimum 2 MB. URL eksternal ditolak. Foto yang dipakai adalah salinan terkompresi tanpa metadata EXIF; koordinat, email dan data formulir tidak dikirim ke model. Warga diberi tahu sebelum menekan tombol bahwa foto diproses oleh OpenAI. Foto masih dapat mengandung informasi visual pribadi; prompt melarang menyalinnya ke deskripsi.

Respons: `{ success: true, data: { roadDamageVisible, category, sizeClass, condition, uncertainty } }`. Kategori dan ukuran bisa `null`; isian yang tidak memiliki saran dipertahankan. Tanpa pembanding skala, AI diminta tidak menebak kelas ukuran. Foto tidak relevan/tidak jelas tidak dapat diterapkan. Hasil tidak mengubah database, status, instansi, lokasi, atau waktu. UI membatalkan dan membuang hasil analisis foto lama saat foto diganti.

Batas 5 analisis berhasil per IP per 15 menit; respons gagal tidak mengurangi jatah tersebut. Pembatas tambahan 30 percobaan per IP per menit mencegah permintaan beruntun, validasi origin, timeout, validasi respons dengan Zod. Rate limit berada dalam memori proses; untuk banyak instance gunakan store rate limit bersama sebelum memperluas kapasitas.

## Validasi

- `npm run typecheck`
- `npx tsx tests/photo-analysis.test.ts` — provider tiruan, tanpa database atau biaya API.

Implementasi mengikuti [Images and vision](https://developers.openai.com/api/docs/guides/images-vision?api-mode=chat) dan [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat), menggunakan Chat Completions yang tersedia di SDK proyek.

Jika muncul `AI_CONFIG_ERROR`, OpenAI menolak kunci API. Perbarui `OPENAI_API_KEY` di environment backend (lokal `.env` atau dashboard Render), lalu restart/redeploy. Jangan menaruh kunci di frontend. Restart juga mengosongkan rate limit yang tersimpan dalam memori proses. `AI_QUOTA_EXHAUSTED` berarti billing/kuota perlu diperiksa; `AI_MODEL_UNAVAILABLE` berarti model tidak dapat diakses. Pesan provider mentah dan kunci API tidak dikirim ke browser.

## Moderasi wajib dan efisiensi

Pembaruan: pemeriksaan keamanan (`omni-moderation-latest`) dan relevansi foto dilakukan otomatis saat registrasi foto, sebelum foto dihubungkan ke Fakta Asal, serta sebelum pengiriman final. Foto REPORT/BEFORE wajib memperlihatkan kerusakan jalan. Foto AFTER/SIGNOFF tetap melewati moderasi konten, tanpa keharusan menunjukkan kerusakan. Pemeriksaan otomatis ini terpisah dari tombol opsional pembuat saran isian.

Backend mengambil asset dari akun/folder Cloudinary yang dikonfigurasi menggunakan API server, lalu memeriksa salinan JPEG maksimal 768×768 tanpa EXIF. URL browser maupun klaim kelulusan dari klien tidak dipercaya. Foto sensitif ditolak dengan `PHOTO_UNSAFE`, foto tidak relevan `PHOTO_NOT_RELEVANT`. Ketika provider tidak tersedia, proses ditahan, bukan dianggap lolos. Kunci API valid sekarang juga diperlukan untuk registrasi foto dan laporan manual.

Direct upload ke Cloudinary masih terjadi sebelum pemeriksaan, tetapi asset yang gagal tidak didaftarkan sebagai bukti laporan dan tidak dipublikasikan melalui SIJAGO. Asset gagal tidak otomatis dihapus dari Cloudinary; penghapusan/orphan cleanup merupakan pekerjaan terpisah. Foto laporan lama diperiksa kembali ketika dipakai untuk menyimpan fakta atau dikirim. Pembacaan laporan yang sudah terbit tidak memicu moderasi retroaktif.

Efisiensi: klasifikasi relevansi hanya menghasilkan boolean (batas 256 token); saran hanya dibuat setelah tombol ditekan (batas 700 token, sebelumnya 1800); penalaran low untuk model GPT-5/6, gambar detail low, kondisi maksimal 400 karakter dan batasan 180 karakter, tanpa retry otomatis. Cache hash konten selama 10 menit, maksimal 100 entri per tahap, menggabungkan permintaan yang bersamaan. Cache gagal tidak dianggap kelulusan. Foto berubah menghasilkan hash baru. Cache hanya berlaku per proses dan hilang saat restart. Endpoint analisis kini juga menerima `{photoId: UUID}` agar memakai salinan gambar yang sama dan hasil moderasinya dapat dipakai ulang. Gambar bukti yang ditampilkan tetap versi resolusi asli tanpa EXIF.

Pemeriksaan AI dapat salah menolak atau melewatkan konten; ini bukan jaminan deteksi sempurna. Moderasi admin tetap diperlukan. Tidak ada pencatatan gambar/base64 atau pesan provider mentah ke log. Pengujian guardrail: `npx tsx tests/photo-safety.test.ts`, seluruh provider ditirukan.
