# NEXUS HR — PHASE 4.5: LOCAL APPLICATION LAUNCH & LIVE DEMO GUIDE
## Panduan Lengkap Menjalankan Aplikasi dan Skenario Demonstrasi Terdistribusi

**Tanggal:** 2026-11-17  
**Workspace:** `D:\Antigravity_Projects\nexus-hr`  
**Status Saat Ini:** **PARTIALLY RUNNING — CONFIGURATION REQUIRED**  
- **Frontend Web UI:** **RUNNING (ONLINE)** di `http://localhost:5173/`  
- **Backend API Gateway:** **MENUNGGU KONFIGURASI KREDENSIAL LOKAL**  
- **Basis Data Terdistribusi:** **ONLINE & TERUJI** (`wcmevigbqsmzsdqidjel` & `uneycmbqqpkifwhwzbes`)  

---

## 1. Cara Membuka Aplikasi Melalui Browser

Frontend telah berhasil dijalankan sebagai daemon background. Anda dapat langsung membuka aplikasi di browser komputer Anda:

```
http://localhost:5173/
```

Jika mengakses dari perangkat lain dalam jaringan lokal yang sama (Wi-Fi):
```
http://192.168.1.6:5173/
```

---

## 2. URL Layanan Sistem

| Layanan | Status Saat Ini | URL Lokal | Deskripsi |
| :--- | :---: | :--- | :--- |
| **Frontend Web App** | **RUNNING** | `http://localhost:5173/` | Antarmuka pengguna HR Enterprise (React 19 + Tailwind CSS) |
| **Backend API Gateway** | **READY TO START** | `http://localhost:3000/` | Zero-Trust Gateway dengan verifikasi HMAC v2.7 |
| **Node Central (DB)** | **ONLINE** | `https://wcmevigbqsmzsdqidjel.supabase.co` | PostgreSQL 17.11 (Registri Global & Inbox Sinkronisasi) |
| **Node Branch A (DB)**| **ONLINE** | `https://uneycmbqqpkifwhwzbes.supabase.co` | PostgreSQL 17.11 (Roster Lokal, Absensi & Outbox Sinkronisasi) |

---

## 3. Akun Demo yang Tersedia

Aplikasi telah dilengkapi akun demonstrasi resmi. Anda dapat mengetikkan email/password atau menggunakan tombol **Akses Demo Cepat** (One-Click) pada halaman login:

| Peran (Role) | Nama Pengguna | Email Korporat | Kata Sandi | Lingkup Wewenang |
| :--- | :--- | :--- | :--- | :--- |
| **SUPERADMIN** | Alexander Wright | `admin@nexus.local` | `password123` | Akses penuh Pusat, IAM, Audit & Telemetri Global |
| **BRANCH_MANAGER** | Dewi Lestari | `manager.jkt@nexus.local` | `password123` | Manajer Cabang A, Persetujuan Cuti & Roster Cabang |
| **EMPLOYEE** | Budi Santoso | `budi.santoso@nexus.local` | `password123` | Karyawan Staf (`EMP-A-0002`), Presensi Masuk & Jadwal |

---

## 4. Konfigurasi Environment & Persiapan Gateway

Gateway NEXUS HR dirancang dengan prinsip keamanan *Fail-Closed*. Gateway menolak berjalan jika variabel environment sensitif tidak disediakan.

### Variabel Environment yang Diperlukan Gateway:
Untuk menyalakan Gateway lokal, siapkan file `.env` pada folder `gateway/` (atau direktori root) yang memuat nama variabel berikut:
- `PORT=3000`
- `SUPABASE_CENTRAL_URL=https://wcmevigbqsmzsdqidjel.supabase.co`
- `SUPABASE_CENTRAL_SERVICE_ROLE_KEY` *(Kredensial privat Central)*
- `SUPABASE_BRANCH_A_URL=https://uneycmbqqpkifwhwzbes.supabase.co`
- `SUPABASE_BRANCH_A_SERVICE_ROLE_KEY` *(Kredensial privat Branch A)*
- `GATEWAY_ACTOR_HMAC_KEY_ID=gw-hmac-v1`
- `GATEWAY_ACTOR_HMAC_KEY` *(Kunci kriptografi 256-bit acak, minimal 32 karakter)*
- `BRANCH_A_ID=00000000-0000-0000-0000-000000000001`
- `BRANCH_A_CODE=BRANCH-A`

> [!IMPORTANT]
> Sesuai aturan keselamatan sistem, agent dilarang membuat atau menuliskan secret produksi secara otomatis tanpa otorisasi langsung dari operator. Masukkan nilai kredensial di atas secara mandiri pada file `.env`.

---

## 5. Tata Kelola Terminal (Multi-Terminal Management)

Gunakan 3 terminal terpisah untuk mengoperasikan seluruh subsistem:

### Terminal 1 — Backend API Gateway
```powershell
Set-Location "D:\Antigravity_Projects\nexus-hr\gateway"
npm start
```
*Output sukses:*
```
[INFO] gateway.started {"port":3000,"branchId":"00000000-0000-0000-0000-000000000001","activeKeyId":"gw-hmac-v1"}
```

### Terminal 2 — Frontend Application
*(Saat ini sudah berjalan otomatis di background Antigravity task).*  
Jika ingin menjalankan ulang secara manual di terminal terpisah:
```powershell
Set-Location "D:\Antigravity_Projects\nexus-hr\frontend"
npm run dev
```

### Terminal 3 — Distributed Sync Worker
```powershell
Set-Location "D:\Antigravity_Projects\nexus-hr\gateway"
npm run sync:watch
```
*Worker akan memantau Branch A `public.sync_outbox` dan mengirim event baru ke Central setiap 5 detik.*

---

## 6. Tiga Skenario Demonstrasi Lengkap

### SKENARIO A — KONDISI NORMAL (CENTRAL & BRANCH ONLINE)

1. Pastikan **Terminal 1 (Gateway)**, **Terminal 2 (Frontend)**, dan **Terminal 3 (Sync Worker)** berjalan.
2. Buka browser: `http://localhost:5173/`.
3. Klik tombol demo **Budi Santoso (Karyawan Cabang A)**.
4. Buka menu **Pencatatan Kehadiran & Log Absensi** (`/attendance`).
5. Klik tombol hijau **Catat Presensi Masuk Sekarang**.
6. Notifikasi sukses muncul: `Presensi masuk tercatat (Terverifikasi HMAC)`.
7. Perhatikan Terminal 3 (Sync Worker):
   ```
   [INFO] sync.batch.claimed {"batchSize":1}
   [INFO] sync.batch.completed {"claimed":1,"published":1,"failed":0}
   ```
8. Verifikasi: Data masuk ke Branch A, ditransfer ke Central Inbox, dan ringkasan kehadiran Central otomatis terbarui.

---

### SKENARIO B — SIMULASI GANGGUAN JARINGAN PUSAT (CENTRAL INTERRUPTED)

Skenario ini membuktikan ketahanan sistem terdistribusi: Cabang tetap dapat melayani presensi mandiri saat koneksi ke Pusat terputus total.

1. Buka Terminal tambahan (atau gunakan perintah partisi resmi):
   ```powershell
   Set-Location "D:\Antigravity_Projects\nexus-hr\gateway"
   npm run sync:partition
   ```
   *Output:*
   ```
   [WARN] sync.partition.active {"message":"Central sync disabled by configuration (CENTRAL_SYNC_ENABLED=false). Events remain safely in Branch A outbox."}
   ```
2. Pada browser, ganti pengguna ke **Siti Rahmawati** (atau catat presensi baru).
3. Lakukan presensi masuk di cabang.
4. **Hasil yang teramati:**
   - Presensi cabang **tetap berhasil 100% tanpa hambatan** (ACID lokal Branch A terjaga).
   - Event sinkronisasi tidak hilang, melainkan tersimpan aman dengan status `PENDING` di `public.sync_outbox`.
   - Tidak ada koneksi yang bocor atau gagal ke Central.
5. **Catatan Sesi Login:** Karyawan yang telah memiliki sesi aktif dapat terus bekerja. Keterbatasan teoritis: penerbitan akun/token baru memerlukan koneksi ke Central GoTrue.

---

### SKENARIO C — PEMULIHAN KONEKSI PUSAT (CENTRAL RESTORED)

Skenario ini membuktikan rekonsiliasi otomatis dan jaminan nol data ganda (idempotensi).

1. Aktifkan kembali sinkronisasi normal pada Terminal 3:
   ```powershell
   Set-Location "D:\Antigravity_Projects\nexus-hr\gateway"
   npm run sync
   ```
   atau jalankan loop kontinu:
   ```powershell
   npm run sync:watch
   ```
2. **Hasil yang teramati di terminal:**
   ```
   [INFO] sync.batch.claimed: event pending diklaim dari Branch A
   [INFO] sync.batch.completed: 1 published, 0 failed
   ```
3. Status outbox di Branch A otomatis berubah dari `PENDING` menjadi `PUBLISHED`.
4. Proyeksi di Central `public.attendance_daily_summaries` otomatis memperbarui jumlah kehadiran secara akurat tanpa membuat baris ganda.
5. Jalankan ulang `npm run sync` untuk membuktikan pengujian idempotensi: Central menolak pemrosesan ulang dan tidak ada data yang terduplikasi.

---

## 7. Query Pemeriksaan Data (Read-Only Inspection)

Gunakan query SQL berikut untuk memverifikasi kondisi basis data secara langsung tanpa mengubah data:

### Periksa Status Outbox di Branch A (`uneycmbqqpkifwhwzbes`):
```sql
SELECT event_id, event_type, status, created_at, published_at 
FROM public.sync_outbox 
ORDER BY created_at DESC 
LIMIT 10;
```

### Periksa Rekap Harian di Central (`wcmevigbqsmzsdqidjel`):
```sql
SELECT branch_id, summary_date, total_employees, present_count, late_count, absent_count, source_version 
FROM public.attendance_daily_summaries;
```

### Periksa Direktori Karyawan yang Tersinkronisasi di Central:
```sql
SELECT employee_code, full_name, department_name, position_title, version, last_synced_at 
FROM public.employee_directory;
```

### Periksa Log Absensi Riil di Branch A:
```sql
SELECT id, employee_id, attendance_date, check_in_time, status, is_verified 
FROM public.attendance 
ORDER BY created_at DESC 
LIMIT 5;
```

---

## 8. Panduan Troubleshooting

| Masalah | Penyebab | Solusi |
| :--- | :--- | :--- |
| **Gateway error:** `Missing or placeholder environment variable: SUPABASE_CENTRAL_URL` | File `.env` belum dibuat di `gateway/` atau variabel belum di-export | Buat file `.env` di `gateway/` sesuai petunjuk Bagian 4. |
| **Browser menampilkan error jaringan:** `Failed to fetch` saat presensi | Gateway di port 3000 belum menyala, sedangkan frontend dalam mode `live` | Nyalakan Gateway di Terminal 1, atau ganti `VITE_API_MODE=mock` pada `frontend/.env` jika ingin mencoba antarmuka secara offline mandiri. |
| **Port 5173 atau 3000 sudah terpakai** | Ada proses lama yang masih berjalan | Periksa proses dengan `Get-Process node` dan hentikan jika diperlukan, atau ganti port di konfigurasi. |
| **Lencana Topbar:** `Simulasi Offline (Mock)` | Frontend membaca konfigurasi mock | Pastikan `frontend/.env` memuat `VITE_API_MODE=live` dan `VITE_USE_MOCK_API=false`. |

---

## 9. Status Akhir

**STATUS: PARTIALLY RUNNING — CONFIGURATION REQUIRED**  
- Frontend aktif di `http://localhost:5173/` dan dapat dibuka di browser saat ini.
- Gateway dan Sync Worker siap dijalankan di Terminal 1 & 3 setelah file `.env` lokal diisi kredensial privat.
