# Panduan Lengkap Build APK LUT Studio di Termux

Dokumen ini menjelaskan secara rinci cara mengubah project ini menjadi aplikasi Android (.apk) menggunakan lingkungan **Termux**.

## Prasyarat Utama
Pastikan Anda memiliki koneksi internet yang stabil dan ruang penyimpanan setidaknya **2GB** kosong di HP Anda.

---

## Langkah 1: Persiapan Awal Termux

1. **Izinkan Akses Penyimpanan**:
   Buka Termux dan jalankan:
   ```bash
   termux-setup-storage
   ```
   *Klik "Allow" pada popup yang muncul.*

2. **Update Repo & System**:
   ```bash
   pkg update && pkg upgrade -y
   ```

3. **Instal Paket yang Dibutuhkan**:
   Kita butuh Node.js untuk build web, dan OpenJDK + Gradle untuk build Android.
   ```bash
   pkg install nodejs-lts openjdk-17 gradle git binutils -y
   ```

---

## Langkah 2: Persiapan Folder Project

1. **Masuk ke Penyimpanan Internal** (Opsional, agar file mudah ditemukan):
   ```bash
   cd ~/storage/downloads
   ```

2. **Download / Clone Project**:
   Jika Anda mendownload ZIP dari AI Studio, ekstrak ke folder di sini.
   ```bash
   cd lut-studio-project
   ```

3. **Instal Dependensi NPM**:
   ```bash
   npm install
   ```

---

## Langkah 3: Proses Build Web & Android

1. **Build Web Assets**:
   Langkah ini membuat folder `dist` yang berisi file HTML/JS yang sudah dioptimasi.
   ```bash
   npm run build
   ```

2. **Sinkronisasi Capacitor**:
   Ini akan mengcopy file dari folder `dist` ke dalam folder native Android.
   ```bash
   npx cap sync
   ```

3. **Optimasi Gradle (Penting)**:
   Karena Termux berjalan di HP, kita batasi penggunaan RAM agar tidak crash saat build. Jalankan ini:
   ```bash
   export GRADLE_OPTS="-Xmx1536m -XX:MaxMetaspaceSize=512m"
   ```

4. **Kompilasi APK**:
   Masuk ke folder android dan buat file APK-nya.
   ```bash
   cd android
   ./gradlew assembleDebug
   ```

---

## Langkah 4: Mengambil Hasil APK

Setelah build selesai, file APK akan berada di folder:
`app/build/outputs/apk/debug/app-debug.apk`

Untuk memindahkannya ke folder Downloads HP Anda agar bisa diinstal:
```bash
cp app/build/outputs/apk/debug/app-debug.apk /sdcard/Download/LUT_Studio_Alpha.apk
```

Sekarang, buka File Manager di HP Anda, pergi ke folder Download, dan instal `LUT_Studio_Alpha.apk`.

---

## Troubleshooting (Masalah Umum)

- **Error "Permission Denied" saat ./gradlew**:
  Jalankan: `chmod +x gradlew`
- **Build Berhenti (OOM/Out of Memory)**:
  Tutup semua aplikasi background di HP Anda dan pastikan `GRADLE_OPTS` sudah diset seperti di Langkah 3.3.
- **Koneksi "Failed to Fetch" di APK**:
  Pastikan backend server Anda di Cloud Run sudah aktif. APK ini membutuhkan internet untuk memproses gambar.
- **Google Login Tidak Jalan**:
  Anda harus mendaftarkan SHA-1 Fingerprint APK Anda ke Firebase Console.
  Cara cek SHA-1 di Termux:
  ```bash
  keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
  ```

---

**LUT Studio Android Team**
