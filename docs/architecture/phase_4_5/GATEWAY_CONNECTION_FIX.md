# NEXUS HR — PHASE 4.5.1: LOCAL GATEWAY CONNECTION DIAGNOSIS & REMEDIATION REPORT

**Tanggal:** 2026-11-17  
**Workspace:** `D:\Antigravity_Projects\nexus-hr`  
**Status Akhir:** **`BLOCKED — CONFIGURATION REQUIRED`**  

---

## 1. Hasil Diagnosis Komprehensif (Task 1)

Pemeriksaan sistem secara menyeluruh telah dilakukan untuk menjawab penyebab munculnya toast error pada `http://localhost:5173/`:

| Item Diagnosis | Hasil Pemeriksaan | Temuan Teknis |
| :--- | :---: | :--- |
| **Proses Gateway Berjalan?** | **TIDAK** | Tidak ditemukan proses Node.js yang mengeksekusi `gateway/src/index.ts`. |
| **Port 3000 Digunakan?** | **TIDAK** | Perintah `Get-NetTCPConnection -LocalPort 3000` mengonfirmasi port 3000 kosong (tidak ada listener). |
| **File `gateway/.env` Tersedia?** | **TIDAK** | File `.env` belum dibuat pada folder `gateway/`. |
| **Variabel Wajib Lengkap?** | **TIDAK** | Variabel kredensial `SUPABASE_CENTRAL_SERVICE_ROLE_KEY`, `SUPABASE_BRANCH_A_SERVICE_ROLE_KEY`, dan `GATEWAY_ACTOR_HMAC_KEY` belum disuplai. |
| **Frontend Mengarah ke Port 3000?** | **YA** | `frontend/.env` memuat `VITE_API_BASE_URL=http://localhost:3000`. |
| **`VITE_API_MODE=live` Aktif?** | **YA** | Mode live aktif di frontend, sehingga setiap halaman melakukan `fetch('http://localhost:3000/api/...')`. Karena Gateway mati, browser melempar `TypeError: Failed to fetch`. |
| **Kesesuaian Route Endpoint?** | **PARSIAL (MISMATCH)** | Sejumlah endpoint yang dipanggil frontend (`/api/departments`, `/api/positions`, `/api/users`) tidak memiliki route handler pada `gateway/src/app.ts`. Selain itu, Gateway mewajibkan Bearer JWT asimetris resmi dari Central GoTrue. |

---

## 2. Status Node Database & Kunci HMAC (Task 2)

Sesuai aturan keamanan Task 2:
> *"Periksa apakah key ID dan HMAC key lokal cocok dengan key yang tersedia di nexus_internal.gateway_signing_keys. Jika tidak cocok, berhenti dan jelaskan masalahnya. Jangan melakukan INSERT atau UPDATE key tanpa persetujuan."*

### Hasil Audit Katalog `nexus_internal.gateway_signing_keys` di Branch A (`uneycmbqqpkifwhwzbes`):
```sql
SELECT key_id, is_active, activated_at, expires_at, revoked_at 
FROM nexus_internal.gateway_signing_keys;
```
**Hasil:** `[]` (**0 baris / kosong**).

### Analisis Masalah:
1. **Belum Ada Kunci Terdaftar di Database:** Pada Phase 3.13 dan 4.2a, pembuatan tabel `nexus_internal.gateway_signing_keys` telah berhasil, namun pengisian nilai secret HMAC ditunda (*deferred*) demi mematuhi aturan isolasi secret produksi.
2. **Ketiadaan Kunci Lokal:** Karena di tabel basis data belum ada baris kunci yang aktif (`is_active = true`), Gateway lokal tidak memiliki kunci HMAC yang dapat dicocokkan.
3. **Kepatuhan Terhadap Aturan:** Agent dilarang menjalankan `INSERT` atau `UPDATE` kunci kriptografi ke database remote tanpa otorisasi tertulis dari pemilik sistem. Oleh karena itu, eksekusi Gateway harus dihentikan sementara (*fail-closed*) sampai konfigurasi disiapkan.

---

## 3. Matriks Kesesuaian Endpoint Frontend vs Route Gateway (Task 4)

| Endpoint Frontend (`src/services/api.ts`) | Route Gateway (`gateway/src/app.ts`) | Status Keselarasan | Catatan Otorisasi |
| :--- | :--- | :---: | :--- |
| `GET /api/dashboard/summary` | `GET /api/dashboard/summary` | **SESUAI** | Memerlukan Central JWT |
| `GET /api/employees` | `GET /api/employees` | **SESUAI** | Memerlukan Central JWT |
| `GET /api/shifts` | `GET /api/shifts` | **SESUAI** | Memerlukan Central JWT |
| `GET /api/schedules` | `GET /api/schedules` | **SESUAI** | Memerlukan Central JWT |
| `GET /api/attendance` | `GET /api/attendance` | **SESUAI** | Memerlukan Central JWT |
| `GET /api/leave-requests` | `GET /api/leave-requests` | **SESUAI** | Memerlukan Central JWT |
| `POST /api/v1/leave-requests/:id/decide` | `POST /api/v1/leave-requests/:id/decide` | **SESUAI** | Memerlukan Central JWT + HMAC Envelope |
| `GET /api/departments` | *(Tidak terdaftar)* | **MISMATCH (404)** | Frontend memanggil ini saat load halaman |
| `GET /api/positions` | *(Tidak terdaftar)* | **MISMATCH (404)** | Frontend memanggil ini saat load halaman |
| `GET /api/users` | *(Tidak terdaftar)* | **MISMATCH (404)** | Khusus Superadmin IAM |
| `POST /api/attendance/check-in` | *(Tidak terdaftar)* | **MISMATCH (404)** | Endpoint presensi mandiri belum ada di `app.ts` |

### Temuan Arsitektur Autentikasi:
`gateway/src/app.ts` (baris 157–166) mewajibkan token Bearer yang valid secara kriptografis:
```typescript
const rawToken = extractBearerToken(req.headers.authorization);
const claims = await deps.jwtVerifier.verifyToken(rawToken);
const actor = await deps.identityResolver.resolveActor(claims);
```
Sedangkan `LiveApiClient` di frontend saat ini mengirimkan string statis `'demo-bearer-token'`. Jika Gateway dijalankan, verifikasi token akan melempar error `HTTP 401 INVALID_TOKEN`.

---

## 4. Status Layanan Saat Ini

- **Status Gateway:** **OFFLINE** (Menolak start karena variabel environment wajib belum tersedia di `gateway/.env`).
- **Status Central (`wcmevigbqsmzsdqidjel`):** **ONLINE** (PostgreSQL 17.11 dapat diakses via Supabase MCP).
- **Status Branch A (`uneycmbqqpkifwhwzbes`):** **ONLINE** (PostgreSQL 17.11 dapat diakses via Supabase MCP).
- **Status Frontend Live Mode:** **ONLINE di port 5173**, namun melempar toast error karena tidak dapat menjangkau port 3000.
- **Apakah Data Saat Ini Berasal Dari Database?**
  - Pada pengujian Phase 4.4, data presensi dan sinkronisasi outbox telah **100% terbukti nyata di database PostgreSQL Central dan Branch A**.
  - Pada browser saat ini, data **belum tampil** karena koneksi frontend ke Gateway terputus.

---

## 5. Petunjuk Lokasi Pengambilan Kredensial di Supabase Dashboard

Untuk melengkapi `gateway/.env` secara mandiri tanpa membagikan kredensial ke publik:

### 1. `SUPABASE_CENTRAL_SERVICE_ROLE_KEY`
1. Buka [https://supabase.com/dashboard](https://supabase.com/dashboard).
2. Pilih project **`nexus-central`** (Project Ref: `wcmevigbqsmzsdqidjel`).
3. Klik menu **Project Settings** (ikon gerigi di kiri bawah) → **API**.
4. Di bagian **Project API keys**, salin kunci berlabel **`service_role` (secret)**.

### 2. `SUPABASE_BRANCH_A_SERVICE_ROLE_KEY`
1. Pilih project **`nexus-branch-a`** (Project Ref: `uneycmbqqpkifwhwzbes`).
2. Masuk ke **Project Settings** → **API**.
3. Di bagian **Project API keys**, salin kunci berlabel **`service_role` (secret)**.

### 3. `GATEWAY_ACTOR_HMAC_KEY`
Kunci ini adalah secret kriptografi simetris 256-bit acak. Anda dapat membuatnya di terminal lokal dengan perintah:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
*Kunci ini nantinya harus didaftarkan secara terkoordinasi ke tabel `nexus_internal.gateway_signing_keys` di database Branch A agar verifikasi HMAC SQL v2.7 berhasil.*

---

## 6. Solusi Langsung untuk Penggunaan Frontend Saat Ini

Jika Anda ingin langsung menjelajahi seluruh antarmuka NEXUS HR (Dashboard, Data Karyawan, Presensi, Jadwal, Cuti, Manajemen Pengguna) di browser `http://localhost:5173/` **tanpa toast error**, Anda dapat beralih ke mode mock sementara:

Ubah satu baris pada file `frontend/.env`:
```ini
VITE_API_MODE=mock
VITE_USE_MOCK_API=true
```
Setelah diubah, Vite akan langsung melakukan hot-reload:
- Seluruh toast error akan hilang seketika.
- Seluruh dashboard, grafik mingguan, data 7 karyawan, log presensi, dan permohonan cuti akan tampil lengkap dan interaktif.
- Lencana di topbar akan menunjukkan: `Simulasi Offline (Mock)`.
