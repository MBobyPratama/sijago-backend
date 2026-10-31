# Data demo SIJAGO

Seed demo terpisah dari `db:seed` dan tidak dijalankan otomatis saat deployment. Akun admin/instansi production tetap dibuat sendiri melalui `create-portal-account.sql`; seed demo tidak membuat akun atau kata sandi.

1. Pastikan migrasi dan seed data master sudah dijalankan di database tujuan.
2. Atur `DATABASE_URL` di `.env` backend lokal ke database/branch Neon tujuan. Jika mengarah ke database production, data simulasi yang terverifikasi akan tampil pada website production. Gunakan branch demo terpisah jika ingin menjaga data publik tetap berisi laporan nyata.
3. Lihat rencana tanpa mengubah database:

```powershell
npm run db:seed:demo
```

4. Untuk menyimpan data secara eksplisit:

```powershell
npm run db:seed:demo -- --apply
```

Tersedia enam laporan `DEMO-001` sampai `DEMO-006`: menunggu verifikasi, terverifikasi, diteruskan ke PUPR/BBPJN, diproses Bina Marga, dan ditolak. Judul, patokan, serta isi diberi penanda SIMULASI. Koordinat dan penugasan bukan bukti kondisi/kewenangan jalan nyata. Laporan memiliki fakta, draf template, persetujuan, dukungan contoh, dan audit seeding yang konsisten.

Menjalankan ulang seed melewati laporan demo yang sudah ada, tanpa menimpa perubahan admin/petugas atau menghapus laporan warga. Seed tidak mengaktifkan instansi, mengubah email resmi, mengirim email, memanggil AI, membuat foto palsu, atau mengisi data cuaca buatan. Unggah foto sendiri melalui alur aplikasi jika diperlukan. Tidak ada laporan selesai yang dibuat tanpa bukti foto perbaikan.
