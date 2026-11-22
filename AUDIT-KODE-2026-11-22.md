# Audit Kode RUANG TEGAK — 22 November 2026

## Cakupan pemeriksaan

Pemeriksaan awal mencakup seluruh 36 berkas pada pohon repositori: halaman HTML, aset CSS/JavaScript/SVG, manifest dan Service Worker, kode Android/Gradle, workflow GitHub Actions, fungsi Supabase, seluruh migrasi SQL, data SKU, dan README.

Pemeriksaan dilakukan dengan membaca berkas dari branch utama, penelusuran alur autentikasi/peran, pemeriksaan referensi lokal dan ID HTML, serta pemeriksaan format JSON dan keseimbangan kurung CSS. Ini bukan pengganti pengujian browser/WebView dan pengujian terhadap database Supabase yang sedang berjalan.

## Temuan yang sudah diperbaiki

| No. | Berkas | Temuan | Perbaikan |
|---|---|---|---|
| 1 | `sw.js` | Saat navigasi gagal karena offline, semua halaman yang tidak ditemukan di cache dapat diganti dengan `belajar.html`. Akibatnya rute yang diminta dapat menampilkan halaman yang salah. | Fallback sekarang hanya mencari URL/halaman yang sama; tidak lagi mengalihkan halaman lain ke Belajar. Cache dinaikkan ke `v6`. Commit `b7906b0`. |
| 2 | `belajar.html` | URL `admin_handoff=1` dapat melewati formulir hanya berdasarkan adanya sesi lokal, walaupun token handoff baru tidak ditemukan. Sesi lama dari akun lain berpotensi dipakai. | Auto-login Admin Utama sekarang mensyaratkan token bridge yang valid dan sesi hasil pemulihan. Jika token tidak ada/kedaluwarsa, formulir tetap ditampilkan dengan pesan yang jelas. Commit `2d0d387`. |
| 3 | `admin-kwarran.html` | Kegagalan memuat dashboard setelah autentikasi menyebabkan aplikasi langsung sign-out. Gangguan jaringan sementara dapat membuat Admin Kwarran harus login ulang. | Sesi tetap dipertahankan; pesan kegagalan data ditampilkan pada halaman dashboard dan pengguna dapat mencoba Perbarui Data. Commit `65625a9`. |
| 4 | `belajar.html` | Kolom login tidak memiliki atribut `name`, yang dapat mengurangi pengenalan kolom oleh autofill/password manager Android. | Menambahkan `name=email/password`, `inputmode=email`, `autocapitalize=none`, dan `spellcheck=false` pada kolom email. Ini peningkatan kompatibilitas autofill, belum membuktikan akar masalah nilai kolom yang hilang. Commit `515f170`. |
| 5 | `README.md` | Dokumentasi masih menunjuk `admin.html` sebagai halaman Admin utama dan menyatakan semua akun menunggu persetujuan, tidak sesuai dengan halaman/perilaku pendaftaran terbaru. | Dokumentasi diperbarui mengikuti halaman dan struktur kewenangan saat ini. Commit `fae29cc`. |

## Perbaikan lanjutan setelah audit awal

| 6 | `android/app/src/main/java/id/ruangtegak/app/MainActivity.java` | Jika Android memulihkan Activity tetapi `WebView.restoreState()` tidak menghasilkan riwayat yang valid, WebView dapat tetap tanpa halaman awal. | Hasil pemulihan sekarang diperiksa; jika gagal/kosong, aplikasi memuat `APP_URL` sebagai fallback. Commit `f272a06`. |

## Temuan yang perlu tindak lanjut sebelum dinyatakan tuntas

1. **Gejala kolom email/kata sandi pada halaman Belajar belum terbukti akar masalahnya.** Pada kode login yang diperiksa, tidak ditemukan pemanggilan `form.reset()` atau assignment yang sengaja mengosongkan kolom login. Handler login juga menyimpan nilai sebelum permintaan dan mengembalikannya jika formulir tetap ditampilkan. Atribut autofill sudah diperbaiki, tetapi perlu pengujian langsung di browser Android/WebView untuk membedakan autofill yang tidak mengisi dari nilai yang terhapus akibat reload/navigasi.
2. **Migrasi historis `202611160004_registration_kwarran_at_signup.sql`** memiliki perintah yang menetapkan semua baris pangkalan dengan `id_kwarran` berbeda menjadi Kwarran Leles. Ini berisiko menimpa pemetaan wilayah yang sudah ada saat migrasi dijalankan. Migrasi yang sudah diterapkan tidak boleh diedit seolah-olah berjalan ulang; data pemetaan live harus diperiksa sebelum membuat migrasi koreksi.
3. **Pembacaan dashboard belum dipaginasi secara eksplisit.** Beberapa query mengambil daftar pangkalan, peserta, dan progres tanpa `range()`/paginasi. Jika data melewati batas maksimum baris proyek Supabase, rekap berpotensi tidak lengkap. Perlu rancangan paginasi konsisten dan pengujian jumlah data besar.
4. **Build Android masih memakai APK debug.** Workflow belum memakai keystore rilis yang stabil. APK debug dari runner GitHub yang berbeda dapat ditandatangani dengan debug keystore berbeda sehingga pembaruan di atas instalasi sebelumnya dapat ditolak Android. Keystore rilis harus disiapkan sebagai GitHub Actions secret oleh pemilik aplikasi; jangan menyimpan keystore atau password di repositori.
5. **Belum ditemukan rangkaian tes otomatis untuk halaman HTML/JavaScript dan Edge Function.** Build Android saja tidak menguji login, pemulihan sesi, RLS, atau alur pendaftaran. Perlu tes browser dan tes fungsi/database.

## Catatan pemeriksaan

- Referensi lokal yang dipindai pada halaman utama tidak menunjukkan tautan aset/halaman lokal yang hilang.
- Tiga ID ganda yang ditemukan pada `belajar.html` berada di cabang render yang saling eksklusif (butir utama/subpoin dan mode edit/baca), sehingga belum terbukti menjadi duplikasi DOM bersamaan; tidak diubah.
- JSON `manifest.webmanifest`, `google-services.json`, dan data SKU berhasil diparse.
- CSS utama yang diperiksa memiliki jumlah kurung buka/tutup seimbang.
- Belum ada klaim bahwa aplikasi telah lulus uji di perangkat; akses GitHub tidak memberi bukti hasil runtime pada HP.
