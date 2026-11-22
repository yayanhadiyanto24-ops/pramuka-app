# RUANG TEGAK — Sistem Informasi Pramuka Penegak

Aplikasi pendaftaran, pembelajaran SKU, dan pemantauan perkembangan Pramuka Penegak.

## Halaman aplikasi

- `index.html` — beranda dan pendaftaran Peserta Didik, Pembina, serta Admin Kwarran.
- `admin-utama.html` — pengelolaan oleh Admin Utama.
- `admin-kwarran.html` — pemantauan wilayah oleh Admin Kwarran.
- `belajar.html` — materi umum, pembelajaran SKU, profil, dan pemantauan sesuai peran.
- `sekretaris-daftar.html` — pendaftaran Sekretaris Kwarcab melalui undangan sekali pakai.
- `sekretaris-kwarcab.html` — pemantauan baca-saja tingkat Kwarcab.
- `dokumen.html` — pusat dokumen dan poster.
- `uji.html` — halaman pengujian SKU.
- `login-confirm.html` — konfirmasi login QR KTA.

`admin.html` adalah halaman administrasi lama dan bukan tautan utama untuk alur Admin Utama saat ini.

## Struktur kewenangan

- **Admin Utama** — kewenangan tertinggi untuk pengelolaan aplikasi.
- **Admin Kwarran** — pengelolaan/pemantauan dalam cakupan Kwarran yang ditetapkan.
- **Sekretaris Kwarcab** — akses pemantauan baca-saja tingkat Kwarcab.
- **Pembina** — pengelolaan pembinaan pada pangkalan dan satuan yang menjadi kewenangannya.
- **Peserta Didik** — pembelajaran dan pencatatan perkembangan SKU.

Status akun ditetapkan oleh alur pendaftaran dan kebijakan server. Jangan mengasumsikan semua pendaftar selalu berstatus pending; migrasi pendaftaran terbaru mengaktifkan beberapa jenis pendaftaran secara langsung.

## Supabase

- Project ref: `bopxmtxfrlrnywwhywne`
- Edge Function utama: `pramuka-register`
- RPC pendaftaran profil: `public.pramuka_register_profile`
- View rekap: `public.v_admin_ambalan_rekap`

Frontend menggunakan publishable key. Service-role key hanya boleh berada di lingkungan Edge Function.

## Android

Proyek Android berada di folder `android/`. Build APK debug dijalankan melalui GitHub Actions workflow `.github/workflows/build-android.yml`.

## Catatan pengembangan

- Jalankan migrasi Supabase secara berurutan sesuai nama file.
- Periksa perubahan kebijakan RLS dan fungsi `SECURITY DEFINER` sebelum deploy.
- Uji alur masuk setiap peran, perpindahan halaman, dan pemulihan sesi setelah perubahan autentikasi.
- Jangan menaruh service-role key, kata sandi, atau token rahasia di frontend maupun repositori.
