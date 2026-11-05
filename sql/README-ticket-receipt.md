# Bukti pengiriman tiket

Setelah laporan berhasil disimpan, tiket disimpan otomatis pada browser warga. Halaman lacak menampilkan "Laporan dari perangkat ini". Riwayat lokal berisi kode tiket dan waktu penyimpanan, tanpa email atau isi laporan, dibatasi 50 tiket terbaru. Menghapus riwayat browser tidak menghapus laporan server.

Jika warga mengisi email opsional, backend mengambil alamat yang disimpan pada laporan tersebut dan mengirim kode tiket serta tautan pelacakan melalui Resend setelah transaksi laporan berhasil. Status SENT berarti Resend menerima pengiriman, bukan konfirmasi email sudah masuk kotak masuk. Kegagalan email tidak membatalkan laporan. Permintaan submit yang diulang dengan idempotency key sama tidak mengirim email ulang.

## Deployment

Jalankan `drizzle/0004_ticket_receipt_email.sql` di Neon SQL Editor pada database backend sebelum menjalankan versi backend baru, atau jalankan `npm run db:migrate`. Migrasi menambahkan dua kolom opsional pada tabel reports; tidak menghapus laporan atau membuat akun.

Pastikan environment backend memuat `RESEND_API_KEY`, `RESEND_FROM_EMAIL` yang telah diizinkan untuk pengiriman, dan `FRONTEND_URL=https://sijago-frontend.vercel.app`. Receipt memakai alamat frontend ini untuk membentuk tautan pelacakan. Tidak ada perubahan secret frontend yang diperlukan.

Jika proses server berhenti setelah laporan tersimpan tetapi sebelum pengiriman email selesai, status dapat tetap PENDING. Belum ada worker retry otomatis; warga tetap dapat menggunakan tiket tersimpan di perangkat, tombol salin, dan tombol bagikan. Laporan lama tidak dikirimi email secara retroaktif.
