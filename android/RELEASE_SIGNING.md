# Penandatanganan APK rilis RUANG TEGAK

Workflow `.github/workflows/build-android.yml` menghasilkan APK debug untuk pengujian jika keystore rilis belum tersedia. Untuk menghasilkan APK pembaruan yang dapat dipasang di atas instalasi lama, siapkan satu keystore rilis dan simpan salinannya dengan aman.

## Buat keystore (sekali saja)

Jalankan pada komputer tepercaya yang memiliki JDK:

```bash
keytool -genkeypair -v -keystore ruangtegak-release.jks -alias ruangtegak -keyalg RSA -keysize 2048 -validity 10000
```

Simpan file `ruangtegak-release.jks`, password keystore, alias, dan password key di tempat aman. Jangan commit file ke repositori, jangan kirimkan ke chat, dan jangan membuat keystore baru untuk setiap versi.

## Siapkan GitHub Actions Secrets

Buka repository Settings → Secrets and variables → Actions, lalu tambahkan:

- `ANDROID_KEYSTORE_BASE64`: isi Base64 dari file JKS. Linux/macOS: `base64 -w 0 ruangtegak-release.jks` (macOS dapat memakai `base64 ruangtegak-release.jks | tr -d '\\n'`).
- `ANDROID_KEYSTORE_PASSWORD`: password keystore.
- `ANDROID_KEY_ALIAS`: alias, misalnya `ruangtegak`.
- `ANDROID_KEY_PASSWORD`: password key.

Jangan pernah memasukkan nilai secret ke file workflow atau source code. Setelah keempat secret tersedia, jalankan workflow **Build APK Ruang Tegak** dari tab Actions. Workflow memvalidasi alias dan menandatangani APK release dengan keystore yang sama.

## Aturan pembaruan

- Pertahankan keystore dan alias yang sama untuk semua versi berikutnya.
- Naikkan `versionCode` setiap kali merilis APK.
- Simpan cadangan offline keystore dan password. Jika keystore hilang, APK baru tidak dapat memperbarui aplikasi yang sudah dipasang dengan tanda tangan lama.
