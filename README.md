# NotiPay — Notification Payment Gateway

Website NotiPay adalah payment gateway berbasis notifikasi yang dibangun dengan Express.js. Website menerima callback dari aplikasi Android listener, mencocokkan nominal dengan order pending, lalu mengubah statusnya menjadi **success**.

- **Website**: Express.js + EJS + Tabler
- **Hosting**: Vercel
- **Database**: Upstash Redis (REST)
- **File storage**: Vercel Blob (opsional, disarankan)
- **Aplikasi Android**: tersedia di repository terpisah [odzre/apk-listener](https://github.com/odzre/apk-listener)
- **Region**: Malaysia (`MY` / MYR) dan Indonesia (`ID` / IDR)

> Proyek ini adalah alat konfirmasi pembayaran berbasis notifikasi, bukan penyedia payment gateway berlisensi. Pastikan penggunaan sesuai hukum, kebijakan aplikasi pembayaran, dan kebutuhan bisnis Anda. Selalu verifikasi transaksi bernilai besar.

---

## Fitur

### Aplikasi Android
- Checklist aplikasi yang ingin dipantau.
- Filter hanya paket yang dipilih.
- URL callback + API key merchant.
- Callback via WorkManager dengan retry otomatis.
- Tetap berjalan saat aplikasi ditutup melalui foreground service.
- Auto-start setelah reboot bila listener diaktifkan.
- Console log notifikasi lokal dari aplikasi yang dicentang, lengkap dengan status callback, salin, dan hapus log.
- Halaman tes koneksi, status callback terakhir, dan permintaan pengecualian optimasi baterai.
- APK siap pasang tersedia di `public/assets/app/notipay-listener.apk` dan dapat diganti dari admin.

### Website pengguna
- Landing page dark, responsif, navbar interaktif, dan footer lengkap.
- Login, registrasi, dashboard merchant.
- Statistik harian & bulanan per region: pending, success, expired, total success, revenue.
- Riwayat transaksi dan halaman pembayaran publik.
- Pengaturan profil, password, API key, dan URL callback.
- Dokumentasi API.

### Admin (Tabler)
- Dashboard statistik platform, success rate, revenue MY/ID, grafik 7 hari.
- Manajemen pengguna: suspend/aktifkan, rotasi API key, lihat API key.
- Manajemen transaksi: filter, tandai sukses/expired manual.
- Log callback: parsing nominal, status, pencocokan manual.
- Upload aplikasi: server upload, URL eksternal, atau **direct upload ke Vercel Blob** untuk APK besar.
- Pengaturan website: nama, title, deskripsi, logo, favicon, announcement, footer, registrasi, callback secret.

### API
- `POST /api/v1/create-order`
- `GET|POST /api/v1/check-status`
- `POST /api/v1/callback`
- `GET /api/v1/app/latest`
- `GET /api/v1/cron/expire`

---

## Struktur Proyek

```text
.
├── api/index.js                 # entrypoint Vercel
├── src/
│   ├── app.js                   # konfigurasi Express
│   ├── server.js                # server lokal
│   ├── lib/                     # config, store, auth, user, settings, utils
│   ├── routes/                  # public, auth, user, admin, api, callback
│   └── services/                # order, callback, stats, apps, storage
├── views/                       # EJS (public, auth, user, admin, layout)
├── public/assets/               # CSS, JS, APK bawaan
├── tests/                       # test node:test
├── scripts/seed.js
└── vercel.json
```

---

## Menjalankan Lokal

Prasyarat: **Node.js 20+**.

```bash
npm install
cp .env.example .env
npm run seed
npm run dev
```

Buka `http://localhost:3000`.

Login admin default:

```text
Email    : admin@notipay.local
Password : Admin#12345
```

Akun admin dibuat otomatis dari `ADMIN_EMAIL` / `ADMIN_PASSWORD`. **Ganti password sebelum production.**

Tanpa `UPSTASH_REDIS_REST_URL` dan `UPSTASH_REDIS_REST_TOKEN`, aplikasi memakai penyimpanan memori sementara. Data akan hilang saat server restart.

---

## Environment Variables

| Variable | Wajib | Keterangan |
|---|---|---|
| `APP_URL` | Production | URL publik, mis. `https://notipay.vercel.app`. Dipakai untuk URL callback/payment. |
| `NODE_ENV` | Production | Set `production`. |
| `ADMIN_EMAIL` | Disarankan | Email admin bootstrap. |
| `ADMIN_PASSWORD` | Production | Password admin bootstrap. Ganti dari default. |
| `ADMIN_NAME` | Tidak | Nama admin. |
| `UPSTASH_REDIS_REST_URL` | Ya | Endpoint REST database Upstash. |
| `UPSTASH_REDIS_REST_TOKEN` | Ya | Token REST Upstash. |
| `BLOB_READ_WRITE_TOKEN` | Disarankan | Token Vercel Blob untuk upload APK/logo/favicon. |
| `CRON_SECRET` | Disarankan | Melindungi endpoint cron expire. |
| `PORT` | Tidak | Port lokal, default `3000`. |

---

## Setup Upstash

1. Buat database Redis di [Upstash Console](https://console.upstash.com).
2. Pilih database, buka tab **REST API**.
3. Salin `UPSTASH_REDIS_REST_URL` dan `UPSTASH_REDIS_REST_TOKEN`.
4. Simpan sebagai environment variable di Vercel dan/atau `.env` lokal.

Tidak perlu membuat tabel/schema. Key dibuat otomatis saat aplikasi berjalan.

---

## Deploy ke Vercel

1. Push proyek ke GitHub.
2. Import repository di Vercel.
3. Tambahkan environment variables:
   - `APP_URL` = domain production
   - `NODE_ENV=production`
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD`
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
   - `BLOB_READ_WRITE_TOKEN` (buat Blob store dari dashboard Vercel)
   - `CRON_SECRET`
4. Deploy.
5. Login ke `/admin`, buka **Aplikasi** dan unggah versi APK terbaru.

`vercel.json` sudah mengatur:

- Semua route dinamis masuk ke `api/index.js`.
- `views/**` dan `public/**` diikutkan ke function.
- Cron `/api/v1/cron/expire` harian (Hobby plan). Pada Pro plan, ubah jadwal menjadi `*/5 * * * *`.

Order expired juga diproses otomatis saat daftar transaksi/dashboard dimuat dan saat `check-status` dipanggil.

### Catatan upload APK di Vercel

Serverless function Vercel memiliki batas request sekitar **4,5 MB**. Karena itu:

- Jika `BLOB_READ_WRITE_TOKEN` aktif, form APK akan melakukan **direct upload ke Vercel Blob** langsung dari browser, sehingga mendukung file besar.
- Jika Blob tidak aktif, gunakan kolom **URL APK** untuk mengarah ke GitHub Releases/object storage.
- APK bawaan `1.0.0` ikut di deployment. Saat Blob aktif, APK ini otomatis diunggah ke Blob pada bootstrap agar bisa diunduh melewati batas respons function.

---

## Alur Callback

1. API membuat order pending dengan nominal dan region.
2. Aplikasi Android menerima notifikasi dari paket yang dipilih.
3. Aplikasi mengirim POST ke `/api/v1/callback`:

```json
{
  "apikey": "np_live_xxxxxxxxx",
  "package": "id.dana",
  "title": "DANA",
  "text": "RM116.00 diterima untuk -",
  "device_id": "android-01",
  "timestamp": "2026-10-29T02:16:40.000Z"
}
```

4. Website memvalidasi API key, membaca nominal (`RM116.00` → `11600` sen).
5. Website mencari order paling lama dengan status `pending`, region `MY`, nominal `11600`, dan milik API key tersebut.
6. Order diubah menjadi `success`, callback dicatat, dan `check-status` berikutnya mengembalikan `success`.

Callback yang tidak punya nominal atau tidak menemukan order akan muncul di **Admin → Callback** dan bisa dicocokkan manual.

### Format nominal

| Region | Request `amount` | Disimpan | Ditampilkan |
|---|---:|---:|---|
| `my` | `116` | `11600` sen | `RM116.00` |
| `my` | `1` | `100` sen | `RM1.00` |
| `id` | `1000` | `1000` rupiah | `Rp1.000` |
| `id` | `1000000` | `1000000` rupiah | `Rp1.000.000` |

---

## API

Base URL: `https://domain-anda.com/api/v1`

Autentikasi memakai API key dari **Dashboard → Pengaturan**. Kirim sebagai body `apikey`, query `?apikey=`, header `X-API-Key`, atau `Authorization: Bearer <key>`.

### Create order

```bash
curl -X POST https://domain-anda.com/api/v1/create-order \
  -H "Content-Type: application/json" \
  -d '{
    "apikey": "np_live_xxxxxxxxx",
    "region": "my",
    "amount": 116,
    "qris": "00020101021226...",
    "expired": 5
  }'
```

Respons `201`:

```json
{
  "success": true,
  "message": "Order berhasil dibuat.",
  "data": {
    "order_id": "3f48e2f6-...",
    "reference": "NP261029A7K2Q",
    "region": "MY",
    "amount": 11600,
    "formatted_amount": "RM116.00",
    "status": "pending",
    "payment_url": "https://domain-anda.com/pay/NP261029A7K2Q",
    "expires_in": 300
  }
}
```

Field `qris` opsional. Bisa berupa payload QRIS atau URL gambar QR.

### Check status

```bash
curl "https://domain-anda.com/api/v1/check-status?apikey=np_live_xxxxxxxxx&reference=NP261029A7K2Q"
```

Status: `pending`, `success`, `expired`.

### Contoh response error

```json
{ "success": false, "message": "API key tidak valid." }
```

---

## Aplikasi Android

Source code aplikasi listener ada di repository terpisah:

**https://github.com/odzre/apk-listener**

APK siap pasang juga tersedia di website pada:

```text
public/assets/app/notipay-listener.apk
```

### Cara menghubungkan aplikasi

1. Install APK.
2. Buka aplikasi → **Buka** pada kartu **Akses notifikasi** → aktifkan **NotiPay Listener**.
3. Di website, login → **Pengaturan**, salin **API key** dan **URL callback**.
4. Tempel di aplikasi, isi nama perangkat (opsional).
5. Centang aplikasi pembayaran yang ingin dipantau.
6. Tekan **Tes koneksi callback** untuk memastikan API key valid.
7. Aktifkan **Listener background** lalu **Simpan & jalankan**.
8. Nonaktifkan optimasi baterai jika callback tidak masuk pada perangkat tertentu.

Catatan: APK bawaan adalah debug build. Untuk distribusi publik, build release dengan signing key sendiri dari repository Android.

---

## Keamanan

- Password disimpan dengan `scrypt`.
- Session disimpan di Upstash dengan cookie `HttpOnly`, `SameSite=Lax`, dan `Secure` di production.
- Form memakai CSRF double-submit token.
- Callback merchant memakai API key yang ter-scope per akun.
- Global callback secret hanya untuk admin/testing dan dapat diregenerasi.
- API key bisa dirotasi dari dashboard user atau admin.
- Rate limit tersedia untuk login/register dan API.

Yang perlu Anda lakukan sebelum production:
- Ganti `ADMIN_PASSWORD`.
- Gunakan HTTPS.
- Set `APP_URL`.
- Aktifkan `BLOB_READ_WRITE_TOKEN` dan `CRON_SECRET`.
- Audit log callback secara berkala.
- Jangan membagikan API key atau file `.env`.

---

## Testing

```bash
npm test
```

Test mencakup parsing nominal MY/ID, format mata uang, pencocokan callback, isolasi order antar merchant, dan order expired.

Cek kualitas dasar:

```bash
npm run lint
```

---

## Troubleshooting

**Callback tidak masuk**
- Pastikan akses Notification Access aktif.
- Pastikan URL callback benar dan HTTPS.
- Cek **Admin → Callback**; jika kosong, callback tidak sampai ke server.
- Matikan optimasi baterai untuk aplikasi listener.
- Coba tombol **Tes koneksi callback**.

**Order tidak berubah sukses**
- Nominal notifikasi harus sama persis dengan order pending.
- Region harus sama (`RM` → MY, `Rp`/`IDR` → ID).
- Order harus milik API key pengirim callback.
- Jika notifikasi tidak memiliki nominal, cocokkan manual dari admin.

**Data hilang setelah restart**
- Upstash belum dikonfigurasi, sehingga aplikasi memakai memori sementara.

**Upload APK gagal di Vercel**
- Aktifkan Blob dan gunakan direct upload, atau isi URL APK eksternal.
- Batas upload Blob pada form adalah 250 MB.

---

## Lisensi

Kode ini disediakan untuk kebutuhan implementasi Anda. Anda bertanggung jawab atas kepatuhan hukum, keamanan, dan operasional layanan.
