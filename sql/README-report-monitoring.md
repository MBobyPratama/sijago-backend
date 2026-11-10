# Penutupan otomatis laporan

Backend memeriksa laporan saat server mulai dan setiap 60 detik. Hanya laporan berstatus `SELESAI` dengan `monitoring_ends_at <= waktu pemeriksaan` yang menjadi `DITUTUP`. `closed_at` diisi dengan waktu pemrosesan dan perubahan dicatat sebagai audit `STATUS_CHANGED` oleh `SISTEM`.

Laporan `DIBUKA_KEMBALI`, status lainnya, dan laporan tanpa tanggal akhir pemantauan tidak ditutup. Baris dikunci selama transaksi sehingga pemeriksaan tidak bertabrakan dengan penilaian warga; pengulangan tidak menambah audit penutupan yang sama.

Pemrosesan memakai batch 100 laporan. Tidak perlu migrasi database. Pemeriksaan hanya berjalan selama proses backend aktif. Jika layanan berhenti atau tidur, laporan yang melewati tenggat diproses ketika backend aktif kembali.

Saat instansi menyelesaikan laporan, durasi pemantauan mengambil `signoff_monitoring_days` (default 30 hari). Perubahan konfigurasi berlaku untuk penyelesaian berikutnya dan tidak mengubah tenggat laporan yang sudah tersimpan.

Validasi: `npx tsx tests/report-monitoring.test.ts` memakai transaksi database yang selalu di-rollback.
