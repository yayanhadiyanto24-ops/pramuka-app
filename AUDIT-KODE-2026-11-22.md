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

| 7 | `admin-kwarran.html` | Handler login menganggap `SubmitEvent.submitter` selalu tersedia. Pada jalur submit tertentu di WebView/keyboard, nilainya dapat `null`, sehingga handler gagal sebelum autentikasi. | Handler sekarang memakai tombol submit sebagai fallback, menjaga tombol tetap aman saat `submitter` null, dan menangani kegagalan pembacaan sesi tanpa melempar error baru. Atribut `name` email/kata sandi juga ditambahkan untuk autofill. Commit `89f55a1`. |

| 8 | Database Supabase · `public.pembina_review_nta(uuid,text)` | Advisor mendeteksi fungsi `SECURITY DEFINER` ini juga dapat dipanggil role `anon`. Isi fungsi memang menolak pemanggil tanpa `auth.uid()` dan memeriksa kewenangan Pembina melalui `private.can_review_student`, tetapi grant anonim tidak diperlukan. | Dicabut `EXECUTE` untuk `anon`; grant `authenticated` dan `service_role` tetap. ACL diverifikasi ulang dan tidak lagi memuat `anon`. Migrasi database `20261122152049_revoke_anon_pembina_review_nta` disimpan di repositori. Commit file migrasi `24d7187`. |

| 9 | `supabase/functions/pramuka-register/index.ts` · simpan data pangkalan Pembina | Pembaruan tabel `pangkalan` dilakukan lebih dulu, lalu audit ditulis pada operasi terpisah. Jika penulisan audit gagal, perubahan data sudah tersimpan tetapi aplikasi melaporkan kegagalan. | Dibuat RPC `pembina_update_pangkalan_with_audit` yang memvalidasi Pembina aktif dan kepemilikan pangkalan, lalu mengunci baris, memperbarui data, dan menulis audit dalam satu transaksi. RPC hanya dapat dipanggil `service_role`; Edge Function sekarang memakainya. Pengujian transaksi rollback dan validasi field berhasil. Migrasi `20261122152149_atomic_pembina_pangkalan_audit`. Commit migrasi `3258bfa`, Edge Function `987dd3e`. |

| 10 | `sekretaris-kwarcab.html` | Login, pemulihan sesi, dan tombol Perbarui Data melakukan sign-out saat dashboard gagal dimuat sementara. | Sesi Sekretaris tetap dipertahankan; kegagalan data ditampilkan agar bisa dicoba ulang. Tombol refresh juga tidak lagi mengeluarkan akun. Atribut `name` ditambahkan pada kolom login. Commit `59a893b`. |
| 11 | `admin-utama.html` | Setelah Admin Utama berhasil diverifikasi, kegagalan pemuatan dashboard dapat menghapus sesi. Tombol Perbarui Data juga tidak menampilkan pesan kegagalan dengan baik. | Sesi Admin Utama yang sudah lolos `bootstrap_admin` dipertahankan saat data gagal dimuat; sesi yang gagal verifikasi Admin Utama tetap ditutup. Refresh menampilkan pesan error dan kolom login diberi atribut `name`. Commit `f07b177`. |

| 12 | Database Supabase · indeks `public.pangkalan_sangga` | Terdapat dua unique index identik pada `(id_pangkalan, jenis_kelamin, nama_sangga)`, satu bagian dari constraint unik dan satu indeks duplikat mandiri. | Indeks duplikat mandiri dihapus; indeks yang menopang constraint unik tetap ada. Pemeriksaan pascaperubahan memastikan indeks duplikat hilang dan constraint unik tetap terjaga. Migrasi `20261122152341_remove_duplicate_pangkalan_sangga_index`. Commit `0f1b703`. |

## Temuan yang perlu tindak lanjut sebelum dinyatakan tuntas

1. **Gejala kolom email/kata sandi pada halaman Belajar belum terbukti akar masalahnya.** Pada kode login yang diperiksa, tidak ditemukan pemanggilan `form.reset()` atau assignment yang sengaja mengosongkan kolom login. Handler login juga menyimpan nilai sebelum permintaan dan mengembalikannya jika formulir tetap ditampilkan. Atribut autofill sudah diperbaiki, tetapi perlu pengujian langsung di browser Android/WebView untuk membedakan autofill yang tidak mengisi dari nilai yang terhapus akibat reload/navigasi.
2. **Migrasi historis `202611160004_registration_kwarran_at_signup.sql`** memang menetapkan semua baris pangkalan yang berbeda menjadi Kwarran Leles saat migrasi dijalankan. Pemeriksaan database live menunjukkan migrasi tercatat pada 16 November 2026 pukul 11:12 UTC; pangkalan Sindangbarang yang sekarang ada dibuat pukul 11:49 UTC, sesudah migrasi. Empat pangkalan Leles yang ada bertanggal 15–17 November. Jadi data saat ini tidak menunjukkan pemetaan Sindangbarang yang lebih lama tertimpa, tetapi riwayat sebelum migrasi tidak dapat dipulihkan hanya dari kondisi tabel sekarang. Migrasi lama tidak diubah.
3. **Pembacaan dashboard belum dipaginasi secara eksplisit.** Beberapa query mengambil daftar pangkalan, peserta, dan progres tanpa `range()`/paginasi. Jika data melewati batas maksimum baris proyek Supabase, rekap berpotensi tidak lengkap. Perlu rancangan paginasi konsisten dan pengujian jumlah data besar.
4. **Build Android masih memakai APK debug.** Workflow belum memakai keystore rilis yang stabil. APK debug dari runner GitHub yang berbeda dapat ditandatangani dengan debug keystore berbeda sehingga pembaruan di atas instalasi sebelumnya dapat ditolak Android. Keystore rilis harus disiapkan sebagai GitHub Actions secret oleh pemilik aplikasi; jangan menyimpan keystore atau password di repositori.
5. **Belum ditemukan rangkaian tes otomatis untuk halaman HTML/JavaScript dan Edge Function.** Build Android saja tidak menguji login, pemulihan sesi, RLS, atau alur pendaftaran. Perlu tes browser dan tes fungsi/database.
6. **Supabase Auth belum mengaktifkan perlindungan kata sandi bocor.** Advisor mengingatkan fitur pemeriksaan kata sandi kompromi masih nonaktif. Ini pengaturan Auth tingkat proyek yang perlu ditinjau Admin Utama sebelum diaktifkan.
7. **Advisor masih menandai fungsi `pembina_review_nta` karena role `authenticated` dapat menjalankan SECURITY DEFINER.** Ini diperlukan oleh tombol verifikasi di halaman Belajar; isi fungsi memeriksa `auth.uid()`, status akun, kecocokan satuan, dan verifikasi KTA Pembina sebelum mengubah data. Grant untuk `anon` sudah dicabut. Temuan authenticated dicatat sebagai akses terproteksi yang memang dibutuhkan, bukan dihapus dengan memutus fitur.

## Catatan pemeriksaan

- Referensi lokal yang dipindai pada halaman utama tidak menunjukkan tautan aset/halaman lokal yang hilang.
- Tiga ID ganda yang ditemukan pada `belajar.html` berada di cabang render yang saling eksklusif (butir utama/subpoin dan mode edit/baca), sehingga belum terbukti menjadi duplikasi DOM bersamaan; tidak diubah.
- JSON `manifest.webmanifest`, `google-services.json`, dan data SKU berhasil diparse.
- CSS utama yang diperiksa memiliki jumlah kurung buka/tutup seimbang.
- Belum ada klaim bahwa aplikasi telah lulus uji di perangkat; akses GitHub tidak memberi bukti hasil runtime pada HP.
