# Sistem Informasi Pramuka Penegak

Aplikasi pendaftaran dan pemantauan perkembangan Pramuka Penegak.

## Fitur
- Pendaftaran Peserta Didik memakai kode gabung pangkalan.
- Pendaftaran Pembina untuk pangkalan baru atau pangkalan terdaftar.
- Satu Admin Utama pemilik aplikasi; tidak ada admin pangkalan.
- Persetujuan dan penonaktifan akun.
- Rekap tiap ambalan Putra/Putri: jumlah peserta, aktif, menunggu, tingkatan Calon Penegak/Bantara/Laksana/Garuda, dan jumlah sangga.
- Daftar pangkalan dan kode gabung.

## Supabase
- Project ref: `bopxmtxfrlrnywwhywne`
- Edge Function: `pramuka-register` (ACTIVE, version 2)
- RPC: `public.pramuka_register_profile`
- View rekap: `public.v_admin_ambalan_rekap`

## Halaman
- Pendaftaran: `index.html`
- Admin Utama: `admin.html`

## Satu konfigurasi yang masih diperlukan
Email Admin Utama belum ditetapkan pada `public.app_admin_config.admin_email`. Login admin akan ditolak sampai email pemilik aplikasi dikonfigurasi.

## Keamanan
Frontend hanya menggunakan publishable key. Service-role key berada di Edge Function. Pendaftaran profil diproses server-side. Tabel inti tetap RLS aktif tanpa akses publik langsung. Akun pendaftar berstatus `pending` sampai disetujui Admin Utama.
