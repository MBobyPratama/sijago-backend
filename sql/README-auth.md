# Akun portal SIJAGO

Buka `create-portal-account.sql` di SQL Editor Neon pada database SIJAGO.

1. Jalankan bagian 1 untuk menyiapkan tabel sesi. Tidak ada akun yang dibuat oleh bagian ini.
2. Pada bagian 2, isi `v_email`, `v_full_name`, dan `v_password` dengan nilai Anda sendiri.
3. Untuk admin gunakan `v_role := 'ADMIN'` dan `v_agency_code := NULL`. Untuk petugas gunakan `v_role := 'PETUGAS_INSTANSI'` dan kode instansi yang tampil pada bagian 3.
4. Jalankan blok `DO` satu kali per akun, menggunakan email dan kata sandi yang berbeda. Email duplikat menghasilkan error; tidak ada penggantian kata sandi diam-diam.
5. Masuk melalui `/login`. Admin menuju moderasi, petugas menuju laporan instansinya. `SUPER_ADMIN` memiliki akses admin; `AUDITOR` hanya dapat membaca audit dan ringkasan cuaca.

Kata sandi di-hash dengan pgcrypto bcrypt, biaya 12; gunakan 12 karakter atau lebih, maksimal 72 byte UTF-8. Jangan membagikan query yang sudah diisi kata sandi. Tidak ada akun atau kata sandi bawaan di seeding.

Sesi disimpan di database selama 8 jam secara default (`SESSION_TTL_HOURS`). Cookie `sijago_session` bersifat HttpOnly, SameSite=Lax, dan Secure pada production. Logout mencabut sesi server. Menonaktifkan akun/instansi atau mengganti hash kata sandi membatalkan akses sesi yang ada. MFA yang sudah diaktifkan tidak dilewati; akun tersebut ditolak sampai alur MFA tersedia.

Frontend meneruskan API melalui `/api/backend`, sehingga cookie tetap berada di origin frontend. Atur `NEXT_PUBLIC_API_BASE_URL` ke backend dari server Next, serta `FRONTEND_URL` dan `CORS_ALLOWED_ORIGINS` pada backend ke origin frontend yang benar. Gunakan HTTPS saat deployment. Origin tambahan dipisahkan koma; port localhost 3000/3001 hanya diizinkan otomatis pada mode development.
