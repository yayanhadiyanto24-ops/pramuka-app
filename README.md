# Sistem Informasi Pramuka Penegak

Aplikasi pendaftaran Pramuka untuk dua peran:
- Peserta Didik: bergabung menggunakan kode pangkalan.
- Pembina: mendaftarkan pangkalan baru atau bergabung ke pangkalan yang sudah ada.

## Proyek Supabase
- Project: PRAMUKA
- Project ref: `bopxmtxfrlrnywwhywne`
- Region: `ap-southeast-1`

## Status implementasi
- [x] Antarmuka pendaftaran awal dipindahkan ke `index.html`.
- [x] Formulir peserta didik dan pembina dipisahkan.
- [x] Browser tidak lagi melakukan INSERT langsung ke tabel sensitif.
- [x] Browser hanya memanggil Edge Function `pramuka-register`.
- [ ] Edge Function `pramuka-register` belum dibuat.
- [ ] Validasi kode gabung, pembuatan akun Auth, dan penyimpanan profil server-side belum diaktifkan.
- [ ] Konfigurasi anon/publishable key belum diisi.

## Konfigurasi frontend
Di `index.html`, isi `SUPABASE_ANON_KEY` dengan anon/publishable key proyek PRAMUKA. Key ini boleh digunakan di browser dengan RLS dan backend yang benar. **Jangan pernah memasukkan service_role key ke file frontend.**

## Catatan keamanan
Jangan membuka akses INSERT publik ke tabel `users`, `pangkalan`, `profil_pembina`, atau `profil_peserta_didik` hanya agar formulir bekerja. Pendaftaran harus diproses melalui Edge Function tepercaya dan operasi database yang tervalidasi.