# Verifikasi email untuk tag dan Community Sign-Off

Jalankan `drizzle/0005_community_verification.sql` pada database Neon yang digunakan backend, atau `npm run db:migrate`, sebelum memakai alur OTP baru. Deploy backend dan frontend bersama perubahan protokol ini. Akun admin/instansi tidak berubah.

## Alur dan pembatasan

1. Browser meminta kode melalui `POST /v1/auth/otp/request` dengan `{ email, reportId }` dan header `X-Device-Id` dari fingerprint lokal. `reportId` adalah UUID laporan.
2. Backend menyimpan hash OTP di PostgreSQL lalu mengirim kode melalui Resend. Respons hanya memuat `challengeId`, status pengiriman, dan masa berlaku; kode tidak dikembalikan ke browser.
3. Verifikasi melalui `POST /v1/auth/otp/verify` dengan `{ email, reportId, challengeId, code }` dan identitas perangkat yang sama.
4. OTP yang benar dikonsumsi secara atomik dan menghasilkan token acak `otpToken`. Database hanya menyimpan hash token tersebut.
5. Permintaan tag dan sign-off wajib menyertakan `{ email, otpToken, ...dataAksi }` serta `X-Device-Id`. Backend memeriksa masa berlaku, tujuan, email, perangkat, dan laporan sebelum memproses aksi. Hash email atau nilai placeholder tidak dapat digunakan sebagai pengganti token.

- OTP berlaku 10 menit, sekali pakai, maksimal 5 percobaan kode salah.
- Pengiriman ulang paling cepat 60 detik dan maksimal 5 kali per email dalam 15 menit. Kode baru menggantikan tantangan lama.
- Token berlaku 30 menit dan hanya untuk laporan serta perangkat yang diverifikasi. Verifikasi baru pada kombinasi email/laporan/perangkat yang sama mencabut token sebelumnya.
- PostgreSQL menyimpan tantangan, penghitung percobaan, dan token sehingga restart backend tidak menghilangkannya.
- Kegagalan pengiriman email membatalkan tantangan; tidak ada kode development atau bypass verifikasi.
- Token tidak disimpan di localStorage. Frontend meminta verifikasi ulang jika token ditolak atau kedaluwarsa.
- Email terverifikasi menjadi identitas stabil untuk tag dan suara. Mengulangi tag tidak menambah hitungan; mengirim ulang penilaian memperbarui suara/komentar email tersebut, bukan membuat suara baru.
- Penilaian dibatasi masa pemantauan perbaikan. Pembukaan kembali memerlukan ambang jumlah suara cepat rusak dan proporsi pada `system_config`, dengan fallback 3 suara serta lebih dari 50%.

`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, serta `PSEUDONYM_HASH_SALT` tetap memakai konfigurasi backend. Pertahankan salt pada deployment ulang agar identitas verifikasi tetap konsisten. Email asli, OTP, dan token mentah tidak disimpan di tabel verifikasi; identitas email serta perangkat disimpan sebagai hash.

Data tag/suara lama dan audit tidak dihapus atau ditulis ulang. Identitas sign-off lama yang tidak mencatat email tidak dapat otomatis disatukan dengan identitas terverifikasi baru.

## Pemeriksaan

```powershell
npm run typecheck
npx tsx tests/community-verification.test.ts
```

Pengujian integrasi memakai pengirim email tiruan dan transaksi database yang selalu di-rollback. Pengujian mencakup restart instance layanan, pemakaian ulang, kedaluwarsa, pembatasan percobaan, pembatasan perangkat/laporan, endpoint tag/sign-off, duplikasi suara, serta pembaruan komentar.
