# LUT Studio - Professional LUT Applicator Online

Sebuah aplikasi web modern untuk mengaplikasikan 3D LUT (Look-Up Table) ke gambar secara batch dengan preview real-time.

## 🚀 Fitur Utama
- **3D LUT Parsing**: Mendukung format `.cube` standar (Header, 3D Size, Data).
- **Real-time Preview**: Lihat perubahan seketika dengan slider perbandingan (Before/After).
- **Batch Processing**: Proses banyak gambar sekaligus dengan kontrol kualitas dan ukuran.
- **Dark Mode UI**: Antarmuka profesional bergaya Lightroom/VSCO.
- **Tanpa Framework JS**: Menggunakan Vanilla JavaScript murni untuk performa maksimal.

## 🛠️ Stack Teknologi
- **Frontend**: HTML5, Vanilla JS, Tailwind CSS (via CDN)
- **Backend**: Node.js (Express) + Sharp (Image Processing)
- **Icons**: Phosphor Icons
- **Fonts**: Inter (Google Fonts)

## 📦 Instalasi & Menjalankan
Aplikasi ini berjalan di lingkungan Node.js (sebagai ganti Flask untuk kompatibilitas infrastruktur).

1. **Install Dependencies**:
   ```bash
   npm install
   ```
   *Catatan: Dependensi utama adalah `sharp` untuk pemrosesan gambar berkecepatan tinggi.*

2. **Jalankan Developer Server**:
   ```bash
   npm run dev
   ```

3. **Akses Aplikasi**:
   Buka `http://localhost:3000` di browser Anda.

## 🔧 Workflow API
- `POST /api/upload-lut`: Mengunggah dan parsing file `.cube`.
- `POST /api/preview`: Mengembalikan gambar preview (base64) dengan LUT yang diterapkan.
- `POST /api/process-batch`: Memproses antrean gambar dan mengembalikan file ZIP.
- `GET /api/download/:jobId`: Mengunduh hasil batch processing.

---
Dikembangkan dengan ❤️ untuk fotografer dan editor.
