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

| 13 | Database Supabase · foreign key pada tabel aplikasi publik | Advisor menemukan 14 foreign key tabel `public` tanpa indeks pendukung. Kolom relasi yang sering dipakai untuk penghapusan/pembaruan berpotensi melambat saat data bertambah. | Ditambahkan 14 indeks untuk seluruh foreign key tabel `public` yang terdeteksi. Foreign key pada schema terkelola `auth` dan `storage` tidak diubah. Verifikasi ulang query katalog menunjukkan tidak ada lagi foreign key tanpa indeks di schema `public`. Migrasi `20261122152406_index_public_foreign_key_columns`. Commit `d809592`. |

| 14 | Database Supabase · RLS `ruang_tegak_admin_devices` | Ada tiga policy lama yang menduplikasi policy Admin Utama terbaru dan memakai pemeriksaan identitas statis, sehingga akses tidak sepenuhnya mengikuti konfigurasi Admin Utama yang aktif. | Tiga policy lama dihapus. Empat policy yang tersisa (SELECT/INSERT/UPDATE/DELETE) memeriksa identitas dan role Admin Utama melalui `app_admin_config` dan tabel `users`. Verifikasi katalog memastikan hanya policy dinamis yang tersisa. Migrasi `20261122152436_remove_legacy_admin_device_policies`. Commit `77f6187`. |

| 15 | Database Supabase · policy `ruang_tegak_admin_devices` | Tiga policy lama juga menyebabkan peringatan evaluasi `auth.uid()` berulang per baris. | Penghapusan tiga policy lama menghilangkan peringatan `auth_rls_initplan` dan menurunkan temuan multiple-permissive-policy dari 5 menjadi 2. Dua kelompok policy lain (`sku_completion_plans` dan `sku_subpoints`) dipertahankan karena mengatur jalur hak akses berbeda (peserta vs Pembina; publik vs Pembina/Admin). |

## Temuan yang perlu tindak lanjut sebelum dinyatakan tuntas

1. **Gejala kolom email/kata sandi pada halaman Belajar belum terbukti akar masalahnya.** Pada kode login yang diperiksa, tidak ditemukan pemanggilan `form.reset()` atau assignment yang sengaja mengosongkan kolom login. Handler login juga menyimpan nilai sebelum permintaan dan mengembalikannya jika formulir tetap ditampilkan. Atribut autofill sudah diperbaiki, tetapi perlu pengujian langsung di browser Android/WebView untuk membedakan autofill yang tidak mengisi dari nilai yang terhapus akibat reload/navigasi.
2. **Migrasi historis `202611160004_registration_kwarran_at_signup.sql`** memang menetapkan semua baris pangkalan yang berbeda menjadi Kwarran Leles saat migrasi dijalankan. Pemeriksaan database live menunjukkan migrasi tercatat pada 16 November 2026 pukul 11:12 UTC; pangkalan Sindangbarang yang sekarang ada dibuat pukul 11:49 UTC, sesudah migrasi. Empat pangkalan Leles yang ada bertanggal 15–17 November. Jadi data saat ini tidak menunjukkan pemetaan Sindangbarang yang lebih lama tertimpa, tetapi riwayat sebelum migrasi tidak dapat dipulihkan hanya dari kondisi tabel sekarang. Migrasi lama tidak diubah.
3. **Paginasi dashboard sudah diterapkan pada Edge Function dan diterbitkan ke Supabase.** Query daftar pangkalan, peserta, Pembina, progres SKU, butir SKU, peringkat, dan perbandingan Kwarran kini diambil bertahap 500 baris dengan urutan stabil. Pengujian regresi sumber memastikan jalur dashboard utama memakai helper ini. Pengujian beban dengan dataset sangat besar masih belum dilakukan.
4. **Workflow Android kini mendukung APK rilis dengan tanda tangan stabil.** Build Gradle dinaikkan ke versionCode 2/versionName 1.0.1. Workflow memakai empat GitHub Actions secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) bila tersedia; jika belum, workflow sengaja menghasilkan APK debug untuk uji dan memberi peringatan. Keystore belum tersedia di repositori sebagai secret, jadi APK pembaruan stabil belum dapat diterbitkan sampai pemilik menambahkan keystore tersebut.
5. **Belum ditemukan rangkaian tes otomatis untuk halaman HTML/JavaScript dan Edge Function.** Build Android saja tidak menguji login, pemulihan sesi, RLS, atau alur pendaftaran. Perlu tes browser dan tes fungsi/database.
6. **Supabase Auth belum mengaktifkan perlindungan kata sandi bocor.** Advisor mengingatkan fitur pemeriksaan kata sandi kompromi masih nonaktif. Ini pengaturan Auth tingkat proyek yang perlu ditinjau Admin Utama sebelum diaktifkan.
7. **Advisor masih menandai fungsi `pembina_review_nta` karena role `authenticated` dapat menjalankan SECURITY DEFINER.** Ini diperlukan oleh tombol verifikasi di halaman Belajar; isi fungsi memeriksa `auth.uid()`, status akun, kecocokan satuan, dan verifikasi KTA Pembina sebelum mengubah data. Grant untuk `anon` sudah dicabut. Temuan authenticated dicatat sebagai akses terproteksi yang memang dibutuhkan, bukan dihapus dengan memutus fitur.

## Verifikasi lanjutan setelah perbaikan

- Workflow GitHub Actions `Uji Regresi RUANG TEGAK` berhasil pada commit `55ecb43ff6ea19113b4a547012dc67d705818471`; workflow Pages juga berhasil pada commit yang sama. Tes mencakup atribut login, perilaku pemilihan peran, paginasi dashboard, RPC audit atomik, Service Worker, Android Autofill, konfigurasi signing, dan sintaks inline JavaScript pada halaman inti.
- Edge Function live `pramuka-register` terverifikasi memuat helper paginasi dan RPC audit atomik; deployment aktif tercatat sebagai versi 78. Log layanan menunjukkan permintaan POST terbaru mendapat respons HTTP 200.


- Pemeriksaan statis ulang pada 10 kondisi kode berhasil: atribut login, tidak adanya reset form login, tab peran tidak memanggil reset, pemulihan sesi admin, fallback submitter, fallback Service Worker, pemulihan WebView, dan penggunaan RPC audit atomik.
- Database live: tidak ada lagi foreign key tanpa indeks pada schema `public`; indeks unik utama Sangga tetap dipertahankan; indeks duplikat telah hilang.
- Advisor performa: peringatan `auth_rls_initplan` telah hilang; multiple-permissive-policy turun dari 5 menjadi 2. Dua sisanya dipertahankan karena memang menggabungkan hak peserta/Pembina dan akses publik/Pembina.
- Advisor keamanan: grant anonim untuk RPC verifikasi NTA sudah hilang. Masih ada peringatan untuk fungsi verifikasi NTA yang memang dipanggil akun terautentikasi dan memiliki pemeriksaan kewenangan di dalam fungsi; 15 tabel tanpa policy tetap tertutup bagi `anon/authenticated` dan digunakan melalui Edge Function service-role.
- Perlindungan kata sandi bocor masih nonaktif pada konfigurasi Auth proyek; ini belum diubah karena merupakan pengaturan keamanan tingkat proyek yang dapat memengaruhi proses pendaftaran.
- **Perpindahan tab Peserta Didik/Pembina yang membuat kolom email dan kata sandi kosong sudah diperbaiki.** Ditemukan bahwa kedua peran menggunakan dua elemen formulir terpisah; saat berpindah tab, pengguna melihat form lain yang semula kosong. `switchTab()` kini memindahkan email dan kata sandi dari tab aktif ke tab tujuan hanya bila kolom tujuan belum berisi, tanpa menyimpan kredensial ke `localStorage`/`sessionStorage`. Tes regresi GitHub Actions pada commit `2039685e3650878a5100a1c896dd07de93d77946` berhasil. Form login pada halaman Belajar tetap memiliki atribut Autofill yang diperbaiki dan WebView Android mengizinkan Autofill; uji perangkat langsung tetap diperlukan untuk memastikan perilaku pengelola kata sandi Android.

## Catatan pemeriksaan

- Referensi lokal yang dipindai pada halaman utama tidak menunjukkan tautan aset/halaman lokal yang hilang.
- Tiga ID ganda yang ditemukan pada `belajar.html` berada di cabang render yang saling eksklusif (butir utama/subpoin dan mode edit/baca), sehingga belum terbukti menjadi duplikasi DOM bersamaan; tidak diubah.
- JSON `manifest.webmanifest`, `google-services.json`, dan data SKU berhasil diparse.
- CSS utama yang diperiksa memiliki jumlah kurung buka/tutup seimbang.
- Belum ada klaim bahwa aplikasi telah lulus uji di perangkat; akses GitHub tidak memberi bukti hasil runtime pada HP.


## Pemeriksaan keamanan database live — 22 November 2026

- Seluruh tabel pada schema `public` yang memiliki hak akses SELECT/INSERT untuk role `anon` atau `authenticated` terverifikasi mengaktifkan RLS. Query katalog tidak menemukan tabel publik yang sekaligus dapat diakses kedua role tersebut tanpa RLS.
- Tabel `users`, `pangkalan`, `profil_pembina`, `admin_kwarran`, `sekretaris_kwarcab`, `pangkalan_change_audit`, dan `kwarran_admin_invites` terverifikasi mengaktifkan RLS. Pembacaan data pengguna dan pangkalan dibatasi oleh policy sesuai identitas/keanggotaan; tabel pengelolaan internal yang tidak memiliki policy tetap tertutup untuk akses langsung.
- `app_admin_config` mengaktifkan RLS dan tidak memiliki policy baca. Walaupun grant SELECT tercatat pada role `anon` dan `authenticated`, RLS tanpa policy membuat kedua role tidak dapat membaca baris konfigurasi. Edge Function membacanya melalui klien service-role; tidak ditemukan referensi tabel ini pada halaman HTML utama.
- RPC `pembina_update_pangkalan_with_audit(bigint,uuid,jsonb)` terpasang di database live, dimiliki `postgres`, dan hanya memberikan EXECUTE kepada `service_role` (selain owner). Fungsi memeriksa Pembina aktif dan kecocokan pangkalan, membatasi nama kolom yang boleh diubah, mengunci baris, serta menyimpan perubahan dan audit dalam satu transaksi.
- Fungsi `pembina_review_nta(uuid,text)` memang dapat dijalankan oleh `authenticated`, tetapi isi fungsi memerlukan `auth.uid()` dan memanggil `private.can_review_student`. Pemeriksaan tersebut mencocokkan Pembina aktif, status KTA/validasi Pembina, satuan yang sama, serta jenis kelamin peserta sebelum status NTA diubah. Grant `anon` sudah dicabut pada migrasi sebelumnya.
- Pemeriksaan data live menemukan 5 pangkalan dengan penempatan pada 2 Kwarran: 4 pada Leles dan 1 pada Sindangbarang. Tidak terlihat seluruh data saat ini terseragamkan ke satu Kwarran.
- Pemeriksaan ini bersifat audit baca-saja; tidak ada perubahan data anggota atau penempatan Kwarran pada tahap ini.
