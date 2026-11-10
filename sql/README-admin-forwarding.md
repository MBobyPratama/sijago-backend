# Verifikasi dan penugasan admin

Tidak memerlukan migrasi baru. Alur menggunakan tabel `reports`, `admin_notes`, `escalations`, dan audit yang sudah ada. Deploy frontend/backend bersama untuk memakai endpoint serta metadata antrean yang baru.

- `POST /v1/admin/reports/:id/verify-and-forward` menerima `{ agencyCode, adminNote? }`. Khusus Admin/Super Admin dan origin yang diizinkan. Verifikasi disimpan dalam transaksi tersendiri; penugasan gagal mengembalikan `assignmentFailed: true` sehingga admin dapat melanjutkan dari status Terverifikasi. Catatan internal tidak dipublikasikan.
- `POST /v1/admin/reports/:id/verify` tetap tersedia untuk **Verifikasi saja**.
- `POST /v1/admin/reports/:id/escalate` meneruskan laporan Terverifikasi/Dibuka kembali. Penugasan, status Diteruskan, antrean email, dan audit `ROUTE_ASSIGNED` disimpan atomik sebelum memanggil penyedia email. Konfirmasi berulang untuk laporan yang sudah diteruskan ke instansi sama mengembalikan penugasan yang ada.
- `GET /v1/admin/agencies` menyediakan instansi aktif beserta email resmi untuk pilihan dan pratinjau penerima.
- `POST /v1/admin/reports/:id/retry-escalation-email` menerima `{ escalationId }`. Hanya email penugasan milik laporan dan instansi yang masih sesuai yang dapat dikirim ulang. Sukses sebelumnya tidak dikirim lagi; email QUEUED harus menunggu dua menit sebelum dapat dicoba kembali untuk memulihkan proses yang terhenti.
- Status email terpisah dari status laporan: QUEUED, SENT/DELIVERED, FAILED/BOUNCED. Email gagal tidak mengubah status laporan Diteruskan. Kirim ulang tidak membuat verifikasi atau penugasan baru. Penerima memakai email resmi terbaru; isi pesan memakai snapshot penugasan. Kunci idempotensi penyedia dibentuk dari ID penugasan dan payload pesan.
- Hasil pengiriman dicatat terpisah sebagai `ESCALATION_EMAIL_SENT` atau `ESCALATION_EMAIL_FAILED`. Batas waktu pengiriman delapan detik. Jika hasil belum dapat dicatat, antrean tetap dapat diperiksa dan dipulihkan lewat tombol kirim ulang; tidak ada worker pengiriman otomatis.
- Antrean staf mengembalikan `escalationEmail` (ID, status, alasan gagal, `canRetry`). Metadata ini, seperti `adminNotes`, dikeluarkan dari API laporan publik.

Pengujian: `node node_modules/tsx/dist/cli.mjs tests/admin-forwarding.test.ts` memakai sender tiruan dan transaksi yang selalu di-rollback; tidak mengirim email atau menyimpan akun/laporan uji.
