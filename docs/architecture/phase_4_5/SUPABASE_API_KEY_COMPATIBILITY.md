# NEXUS HR — PHASE 4.5.2: SUPABASE CREDENTIAL COMPATIBILITY REPORT
**Target Workspace:** `D:\Antigravity_Projects\nexus-hr\gateway`  
**Inspected Infrastructure:**
- Central Project: `nexus-central` (`wcmevigbqsmzsdqidjel`)
- Branch A Project: `nexus-branch-a` (`uneycmbqqpkifwhwzbes`)
- Inspection Date: 2026-11-17  
- Status: **KEY FORMAT VERIFIED (Legacy JWT)** / **COMPATIBILITY FIX REQUIRED (for New sb_secret_ format)**

---

## 1. EXECUTIVE SUMMARY

Pemeriksaan read-only mendalam telah dilakukan terhadap seluruh codebase Gateway NEXUS HR (`D:\Antigravity_Projects\nexus-hr\gateway`) untuk memverifikasi kompatibilitas format kredensial Supabase Service Role Key:

1. **Format yang Didukung Penuh (100% Kompatibel Saat Ini):**
   - **Legacy `service_role` JWT** (`eyJhbGciOiJIUzI1Ni...`)
   - Didukung secara native tanpa perubahan kode apa pun.
   - Sesuai dengan seluruh wire test harness (`44/44 PASS`).

2. **Format yang Tidak Kompatibel Tanpa Perubahan Kode:**
   - **New Supabase Secret Key** (`sb_secret_...`)
   - Jika key berformat `sb_secret_...` dimasukkan ke dalam `.env`, Gateway akan mengalami kegagalan pada runtime: **HTTP 401 `{"message": "Invalid JWT"}`**.
   - Penyebab: Implementasi HTTP client pada Gateway secara eksplisit menyertakan header `Authorization: Bearer ${serviceRoleKey}` di setiap panggilan PostgREST. Supabase platform menolak string non-JWT jika dikirimkan di dalam header `Authorization: Bearer`.

3. **Rekomendasi Utama:**
   - Gunakan format **Legacy `service_role` JWT** dari Supabase Dashboard (`Project Settings` → `API` → `Project API keys` → `service_role`).

---

## 2. DETAIL PEMERIKSAAN KODE GATEWAY

### 2.1. Validasi Environment (`gateway/src/config/env.ts`)
Pemeriksaan pada baris 112–117 dan fungsi `requireNonEmptyEnv()`:

```typescript
// gateway/src/config/env.ts
function requireNonEmptyEnv(raw: string | undefined, name: string): string {
  if (!raw) {
    throw new ConfigError(
      `Variabel environment wajib '${name}' belum diisi. Periksa file .env.`
    );
  }
  const val = raw.trim();
  if (PLACEHOLDER_REGEX.test(val)) {
    throw new ConfigError(
      `Variabel environment wajib '${name}' masih bernilai placeholder ('${val}').`
    );
  }
  return val;
}
```

**Temuan:**
- Validasi pada `env.ts` hanya memeriksa bahwa nilai tidak kosong dan bukan string placeholder (seperti `your-central-key`).
- **Tidak ada regex format JWT** (`^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$`) dan **tidak ada pemeriksaan prefix** (`sb_secret_`).
- Gateway **tidak melakukan decoding atau verifikasi cryptographic signature JWT secara lokal**.
- Artinya, kedua format akan **lolos validasi konfigurasi saat Gateway startup**, namun perbedaan perilaku terjadi saat panggilan jaringan (HTTP wire format).

---

### 2.2. Implementasi Supabase Client & PostgREST Calls

Terdapat tiga modul di Gateway yang melakukan HTTP call ke Central dan Branch A PostgREST:

#### A. Central Client (`gateway/src/clients/central-client.ts`)
- **Lokasi Panggilan:** Baris 49–50 (`executeSql`) dan Baris 150–151 (`postgrestFetch`)
- **Bentuk Header:**
  ```typescript
  headers: {
    apikey: this.serviceRoleKey,
    Authorization: `Bearer ${this.serviceRoleKey}`,
    accept: 'application/json',
    ...options.headers,
  }
  ```

#### B. Branch RPC Client (`gateway/src/clients/branch-rpc-client.ts`)
- **Lokasi Panggilan:** Baris 71–72 (`postgrestFetch`), Baris 303–304 (`getHealth`), Baris 358–359 (`getDeviceHealth`)
- **Bentuk Header:**
  ```typescript
  headers: {
    apikey: this.serviceRoleKey,
    Authorization: `Bearer ${this.serviceRoleKey}`,
    accept: 'application/json',
    ...options.headers,
  }
  ```

#### C. Distributed Sync Worker (`gateway/src/sync/sync-worker.ts`)
- **Lokasi Panggilan:**
  - Baris 210–211: `fetchBranchPendingEvents`
  - Baris 246–247: `postToCentralInbox`
  - Baris 285–286: `markBranchEventsAcknowledged`
  - Baris 316–317: `fetchPendingCentralInboxEvents`
  - Baris 360–361: `markCentralInboxProcessed`
- **Bentuk Header:**
  ```typescript
  headers: {
    apikey: this.serviceKey,
    Authorization: `Bearer ${this.serviceKey}`,
    'Content-Type': 'application/json',
  }
  ```

---

## 3. ANALISIS TEKNIS KOMPATIBILITAS (WIRE SPECIFICATION)

### 3.1. Mekanisme Otentikasi Supabase PostgREST
Supabase menggunakan reverse proxy (Kong API Gateway) di depan PostgREST:
1. **Header `apikey`:** Digunakan Kong untuk routing, rate limiting, dan identifikasi proyek/kredensial. Baik legacy JWT maupun `sb_secret_...` diterima di header ini.
2. **Header `Authorization: Bearer <token>`:** Diteruskan oleh Kong ke PostgREST untuk parsing claims peran PostgreSQL (`role`). PostgREST memvalidasi signature menggunakan `PGRST_JWT_SECRET` dan mengeksekusi:
   ```sql
   SET LOCAL role = 'service_role';
   ```

### 3.2. Evaluasi Format Kredensial

| Karakteristik | Legacy `service_role` JWT | New Supabase Secret Key (`sb_secret_...`) |
| :--- | :--- | :--- |
| **Bentuk Token** | Format JWT 3-bagian (`header.payload.signature`) | String opaque terenkripsi berawalan `sb_secret_` |
| **Kesesuaian di `apikey`** | Valid | Valid |
| **Kesesuaian di `Authorization: Bearer`** | **Valid & Diterima** (PostgREST mengekstrak `role: service_role`) | **Ditolak** (PostgREST gagal melakukan decode JWT → HTTP 401 `Invalid JWT`) |
| **Status pada Gateway Saat Ini** | **KOMPATIBEL PENUH (Ready to Run)** | **TIDAK KOMPATIBEL (Gagal pada wire level)** |
| **Perubahan Kode yang Dibutuhkan** | Tidak ada (0 baris) | Memodifikasi 3 client file |

### 3.3. Rujukan Dokumentasi Resmi Supabase
Dokumentasi resmi Supabase mengenai migrasi API key baru (*Migrating to publishable and secret API keys*):
> *"Send publishable and secret keys on the `apikey` header only. If you also pass the key on the `Authorization: Bearer` header, which many Supabase clients do by default, the platform tries to parse it as a JWT and rejects the request with Invalid JWT."*

Hal ini mengonfirmasi secara definitif bahwa Gateway saat ini **TIDAK DAPAT** menggunakan `sb_secret_...` selama kode masih mengirimkan `Authorization: Bearer ${serviceRoleKey}`.

---

## 4. PERUBAHAN YANG DIPERLUKAN JIKA MENGGUNAKAN `sb_secret_...` (FUTURE OPTION)

Jika di masa mendatang ingin mendukung kedua format (Legacy JWT dan New `sb_secret_`), kode helper header berikut harus diterapkan pada `central-client.ts`, `branch-rpc-client.ts`, dan `sync-worker.ts`:

```typescript
// Helper untuk header PostgREST yang aman untuk kedua format:
function buildAuthHeaders(key: string): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: key,
    accept: 'application/json',
  };
  // Hanya sertakan Authorization: Bearer jika key adalah JWT (memiliki 3 segmen dengan dot)
  if (!key.startsWith('sb_') && key.split('.').length === 3) {
    headers['Authorization'] = `Bearer ${key}`;
  }
  return headers;
}
```

*Catatan: Sesuai aturan read-only pada fase ini, modifikasi kode di atas **tidak dilakukan** saat ini.*

---

## 5. PANDUAN PENGAMBILAN KREDENSIAL DI SUPABASE DASHBOARD

Untuk menjalankan Gateway lokal dengan sukses:

1. Buka dashboard masing-masing proyek:
   - **Central:** `https://supabase.com/dashboard/project/wcmevigbqsmzsdqidjel`
   - **Branch A:** `https://supabase.com/dashboard/project/uneycmbqqpkifwhwzbes`
2. Buka menu navigasi: **Project Settings** (ikon gear di kiri bawah) → **API**.
3. Di bagian **Project API keys**, cari baris:
   - Name: `service_role` (secret)
   - Deskripsi: *This key has the ability to bypass Row Level Security. Never share it publicly.*
   - Karakteristik string: Dimulai dengan `eyJhbGciOiJIUzI1Ni...`
4. Salin string tersebut dan masukkan ke dalam `gateway/.env`:
   - `SUPABASE_CENTRAL_SERVICE_ROLE_KEY` = `<service_role JWT Central>`
   - `SUPABASE_BRANCH_A_SERVICE_ROLE_KEY` = `<service_role JWT Branch A>`

---

## 6. STATUS AKHIR

| Komponen | Status | Keterangan |
| :--- | :--- | :--- |
| **Legacy `service_role` JWT** | **KEY FORMAT VERIFIED** | Siap digunakan langsung tanpa perubahan kode. |
| **New `sb_secret_...` Key** | **COMPATIBILITY FIX REQUIRED** | Memerlukan penyesuaian header HTTP pada client sebelum dapat digunakan. |
