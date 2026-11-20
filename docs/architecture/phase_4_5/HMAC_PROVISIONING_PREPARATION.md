# NEXUS HR — PHASE 4.5.4: HMAC PROVISIONING PREPARATION & SECURITY REVIEW
**Target Workspace:** `D:\Antigravity_Projects\nexus-hr`  
**Role:** Senior Backend Security Engineer & Database Architect  
**Inspected Scope:** 
- Central: `nexus-central` (`wcmevigbqsmzsdqidjel`)
- Branch A: `nexus-branch-a` (`uneycmbqqpkifwhwzbes`)
- Table: `nexus_internal.gateway_signing_keys`
- Codebase: `gateway/src/security/hmac-signer.ts`, `gateway/src/config/env.ts`, `gateway/src/clients/branch-rpc-client.ts`, `supabase/remediation/v2.7.1/001_branch_a_security_remediation_v2_7_1.sql`
- Date: 2026-11-17  
- Status Akhir: **`READY FOR CONTROLLED HMAC PROVISIONING`**

---

## 1. EXECUTIVE SUMMARY

Pemeriksaan dan review persiapan keamanan teknis telah selesai dilakukan secara *read-only* sebelum provisioning HMAC signing key untuk Gateway NEXUS HR.

Hasil audit mengonfirmasi:
1. **Kesesuaian Kontrak 100%:** Kontrak HMAC antara Gateway (`hmac-signer.ts`) dan PostgreSQL Branch A (`verify_gateway_actor()`) adalah versi **v2.7** dengan 12-field pipe-delimited canonical payload, algoritma HMAC-SHA256, format signature 64-karakter lowercase hex, batas TTL maksimal 120 detik, dan single-use nonce ledger.
2. **Isolasi Hak Akses Ketat:** Tabel `nexus_internal.gateway_signing_keys` terisolasi penuh dari role `anon`, `authenticated`, maupun `service_role`. Hanya role `postgres` (database owner) yang memiliki hak akses `INSERT/SELECT/UPDATE`.
3. **Jalur Provisioning:** Jalur yang direkomendasikan adalah injeksi terkendali melalui **Supabase Dashboard SQL Editor** oleh operator resmi, atau script parameterized query lokal yang aman.
4. **Keamanan Kredensial:** Tidak ada secret yang digenerate, disimpan, atau dicetak pada fase ini.

---

## 2. AUDIT KONTRAK HMAC

### 2.1. Struktur Tabel `nexus_internal.gateway_signing_keys`
Ditemukan pada file migrasi `supabase/remediation/v2.7.1/001_branch_a_security_remediation_v2_7_1.sql` (Baris 86–114) dan terverifikasi pada Branch A (`uneycmbqqpkifwhwzbes`):

| Nama Kolom | Tipe Data | Nullable | Default | Keterangan & Constraint |
| :--- | :--- | :--- | :--- | :--- |
| `key_id` | `VARCHAR(64)` | **NO** | *None* | **Primary Key**. Format: `^[A-Za-z0-9._-]{1,64}$` (`chk_gateway_signing_key_id_format`). Karakter `\|`, spasi, atau kontrol dilarang. |
| `hmac_secret` | `TEXT` | **NO** | *None* | Shared secret mentah (UTF-8 text). Panjang minimal `>= 32` bytes (`chk_gateway_signing_key_secret_len`). |
| `is_active` | `BOOLEAN` | **NO** | `TRUE` | Status keaktifan kunci. Wajib `TRUE` untuk validasi transaksi. |
| `activated_at` | `TIMESTAMPTZ` | **NO** | `now()` | Waktu aktivasi kunci. Kunci tidak dapat digunakan sebelum timestamp ini tercapai. |
| `created_at` | `TIMESTAMPTZ` | **NO** | `now()` | Waktu pembuatan record. |
| `rotated_at` | `TIMESTAMPTZ` | YES | `NULL` | Waktu saat kunci baru dipromosikan menggantikan kunci ini. |
| `expires_at` | `TIMESTAMPTZ` | YES | `NULL` | Waktu berakhirnya masa tenggang (*grace period*). Jika `now() >= expires_at`, verifikasi ditolak. |
| `revoked_at` | `TIMESTAMPTZ` | YES | `NULL` | Waktu pencabutan kunci. Constraint: `revoked_at IS NULL OR is_active = FALSE` (`chk_gateway_signing_key_state`). |

### 2.2. Lokasi Source Code Terkait
1. **Database Verification:**  
   `supabase/remediation/v2.7.1/001_branch_a_security_remediation_v2_7_1.sql` (Baris 274–430): Fungsi `nexus_internal.verify_gateway_actor()`.
2. **Gateway Signer & Verifier:**  
   `gateway/src/security/hmac-signer.ts` (Baris 93–108, 130–134, 261–301): Fungsi `buildCanonicalActorPayload()`, `computeActorHmacHex()`, `signActorEnvelope()`.
3. **Gateway Environment Loader:**  
   `gateway/src/config/env.ts` (Baris 50–61, 80–179): Validasi format key ID, panjang byte secret `>= 32`, dan deteksi placeholder.
4. **Branch RPC Client:**  
   `gateway/src/clients/branch-rpc-client.ts` (Baris 113–129, 147–175): Pemanggilan RPC `rpc_branch_decide_leave_request` dan `rpc_superadmin_update_leave_request` yang meneruskan parameter amplop HMAC.

### 2.3. Spesifikasi Canonical Payload & Algoritma
Kontrak canonical string v2.7 terdiri dari 12 field berurutan yang digabungkan dengan delimiter pipa (`|`):

$$\text{Canonical Payload} = \text{concat}(\text{"v2.7"}, |, \text{key\_id}, |, \text{action\_scope}, |, \text{target\_id}, |, \text{operation\_mode}, |, \text{actor\_user\_id}, |, \text{actor\_email}, |, \text{actor\_role}, |, \text{branch\_id}, |, \text{employee\_id}, |, \text{exp}, |, \text{nonce})$$

- **Urutan Field:**
  1. `version`: Literal `'v2.7'`
  2. `key_id`: `gw-hmac-v1` (sesuai `GATEWAY_ACTOR_HMAC_KEY_ID`)
  3. `action_scope`: `'LEAVE_DECIDE'` atau `'LEAVE_SUPERADMIN_UPDATE'`
  4. `target_id`: UUID leave request (lowercase)
  5. `operation_mode`: `'DECISION'` atau `'CORRECTION'`
  6. `actor_user_id`: UUID user aktor Supabase Auth (lowercase)
  7. `actor_email`: Email aktor (lowercase, trimmed, bebas delimiter)
  8. `actor_role`: `'BRANCH_MANAGER'` atau `'SUPERADMIN'`
  9. `branch_id`: UUID Branch A (`00000000-0000-0000-0000-000000000001` atau empty string)
  10. `employee_id`: UUID employee record atau empty string
  11. `exp`: Timestamp kadaluarsa amplop dalam Unix epoch detik (maksimal `epoch_now + 120s`)
  12. `nonce`: UUID v4 acak sekali pakai (*single-use*)
- **Algoritma Digest:**
  - HMAC-SHA256 (`crypto.createHmac('sha256', Buffer.from(secret, 'utf8'))` di Node.js dan `extensions.hmac(convert_to(canonical, 'UTF8'), convert_to(hmac_secret, 'UTF8'), 'sha256')` di PostgreSQL).
  - Output: 64-karakter lowercase hexadecimal string.
  - Verifikasi: Dilakukan secara *constant-time* pada kedua sisi untuk mencegah serangan *timing attack*.

---

## 3. AUDIT HAK AKSES DAN JALUR PROVISIONING

### 3.1. Isolasi Hak Akses (PostgreSQL Privilege Matrix)
Pemeriksaan hak akses pada schema `nexus_internal`:
- `REVOKE ALL ON SCHEMA nexus_internal FROM PUBLIC, anon, authenticated, service_role;`
- `REVOKE ALL ON TABLE nexus_internal.gateway_signing_keys FROM PUBLIC, anon, authenticated, service_role;`

**Temuan Kritis:**
- Role `service_role` (yang digunakan Gateway melalui PostgREST) **TIDAK MEMILIKI IZIN** untuk melakukan `INSERT`, `UPDATE`, `SELECT`, atau `DELETE` pada tabel `nexus_internal.gateway_signing_keys`.
- PostgREST tidak mengekspos schema `nexus_internal`.
- Tidak ada RPC publik yang memungkinkan penulisan ke tabel ini. Hal ini sengaja diterapkan dalam arsitektur keamanan untuk mencegah eksploitasi eskalasi hak akses dari lapisan API.

### 3.2. Evaluasi Jalur Provisioning yang Tersedia

| Jalur Provisioning | Pelaksana / Role | Ketersediaan di Workspace | Keamanan & Risiko | Rekomendasi |
| :--- | :--- | :--- | :--- | :--- |
| **Jalur 1: Supabase Dashboard SQL Editor** | Operator (Role `postgres`) | **Tersedia Penuh** (Akses web console) | **Paling Aman & Bersih**. Kueri dieksekusi via TLS browser langsung ke database engine. Secret tidak pernah tersimpan di file proyek, log terminal, maupun git history. | **REKOMENDASI UTAMA** |
| **Jalur 2: Script Node.js Parameterized (`pg`)** | Driver PostgreSQL Lokal (Role `postgres`) | **Belum Tersedia** (`pg` not installed / `MODULE_NOT_FOUND`) | Memerlukan password database `postgres` dan instalasi package `pg`. Parameterized query (`$1, $2`) mencegah SQL injection, tetapi password database harus disediakan secara lokal. | Alternatif Sekunder (Jika `pg` diinstal) |
| **Jalur 3: Supabase MCP Tool (`execute_sql`)** | Agent Tool via Management API | Tersedia di Agent Environment | **Tidak Direkomendasikan**. Literal SQL pada parameter tool akan tercatat pada log file transkrip percakapan agent (`transcript.jsonl`), melanggar batasan larangan mencatat secret. | **DITOLAK** |
| **Jalur 4: PostgREST API (`service_role`)** | HTTP Gateway PostgREST | Terhubung | **Terblokir Desain Keamanan**. HTTP 403 / 404 karena `REVOKE ALL ON SCHEMA nexus_internal`. | **TIDAK MUNGKIN** |

---

## 4. RENCANA PEMBUATAN DAN PENYIMPANAN HMAC (PROSEDUR PHASE BERIKUTNYA)

Berikut adalah rencana operasional yang dirancang untuk dieksekusi secara aman setelah persetujuan pengguna:

### Langkah 1: Pembangkitan Secret Acak Kriptografis (Lokal Operator)
Dihasilkan menggunakan generator acak berkekuatan tinggi (CSPRNG):
```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```
- Menghasilkan 32 bytes (256-bit) entropi sebagai 64 karakter heksadesimal.
- Memenuhi constraint panjang minimal database (`chk_gateway_signing_key_secret_len >= 32`).

### Langkah 2: Injeksi Kunci ke Branch A via SQL Editor
Eksekusi di **Supabase Dashboard Branch A (`uneycmbqqpkifwhwzbes`)** → **SQL Editor** dalam transaksi terisolasi:

```sql
BEGIN;

-- Verifikasi keberadaan tabel
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'nexus_internal' AND tablename = 'gateway_signing_keys'
    ) THEN
        RAISE EXCEPTION 'Table nexus_internal.gateway_signing_keys does not exist.';
    END IF;
END $$;

-- Injeksi kunci signing
INSERT INTO nexus_internal.gateway_signing_keys (
    key_id,
    hmac_secret,
    is_active,
    activated_at,
    created_at,
    rotated_at,
    expires_at,
    revoked_at
) VALUES (
    'gw-hmac-v1',
    '[NILAI_SECRET_64_HEX_DITEMPEL_DI_SINI]',
    TRUE,
    now(),
    now(),
    NULL,
    NULL,
    NULL
)
ON CONFLICT (key_id) DO UPDATE SET
    hmac_secret = EXCLUDED.hmac_secret,
    is_active = TRUE,
    activated_at = now(),
    expires_at = NULL,
    revoked_at = NULL;

-- Asersi verifikasi satu kunci aktif
DO $$
DECLARE
    v_cnt INT;
BEGIN
    SELECT count(*) INTO v_cnt
    FROM nexus_internal.gateway_signing_keys
    WHERE key_id = 'gw-hmac-v1' AND is_active = TRUE;

    IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'Assertion failed: expected exactly 1 active key for gw-hmac-v1.';
    END IF;
END $$;

COMMIT;
```

### Langkah 3: Konfigurasi Lokal `gateway/.env`
Mengisi secret yang sama secara privat ke file `gateway/.env`:
```ini
GATEWAY_ACTOR_HMAC_KEY_ID=gw-hmac-v1
GATEWAY_ACTOR_HMAC_KEY=[NILAI_SECRET_64_HEX_YANG_SAMA]
```
- File `gateway/.env` telah terlindungi oleh aturan root `.gitignore`.

### Langkah 4: Verifikasi Pasca-Provisioning
Verifikasi hanya dilakukan terhadap metadata (status `is_active`, `key_id`, dan timestamp) tanpa pernah menampilkan atau mencetak isi `hmac_secret`.

---

## 5. ANALISIS RISIKO KEAMANAN & MITIGASINYA

| Risiko Keamanan | Dampak | Mitigasi yang Diterapkan |
| :--- | :--- | :--- |
| **Kebocoran Secret di Git / VCS** | Kompromi otentikasi aktor Gateway | Aturan `.gitignore` aktif; secret tidak pernah ditaruh di repositori atau file dokumentasi. |
| **Pencatatan Secret di Terminal/Logs** | Secret terekam di command history / transcript | Menggunakan input interaktif / SQL Editor dashboard; dilarang menggunakan script logging publik. |
| **Replay Attack Envelope HMAC** | Pemanggilan RPC berulang oleh pihak ketiga | Single-use nonce ledger (`nexus_internal.used_actor_nonces`) dengan TTL ketat maksimal 120 detik. |
| **Kunci Kadaluarsa atau Dicabut** | Gateway gagal memproses permohonan cuti | Mekanisme grace period rotation dan exception handling terstandarisasi (`42501`). |
| **Injeksi Parameter / Delimiter** | Pemalsuan field dalam canonical string | Validasi regex ketat: `key_id` dilarang memuat spasi atau `\|`, email dinormalisasi dan disaring dari karakter kontrol/delimeter. |

---

## 6. DAFTAR HAL YANG BELUM DAPAT DIVERIFIKASI

1. **Password Langsung Role `postgres`:**  
   Password direct PostgreSQL untuk Branch A tidak diketahui (dan tidak disimpan di workspace). Ini memperkuat rekomendasi untuk melakukan provisioning melalui SQL Editor Supabase Dashboard.
2. **Ketersediaan Driver `pg` Lokal:**  
   Package `pg` saat ini belum terpasang di Node.js environment lokal. Jika pengguna memilih jalur CLI lokal di masa depan, `npm install pg` perlu dijalankan terlebih dahulu.

---

## 7. KRITERIA HASIL AKHIR

```
READY FOR CONTROLLED HMAC PROVISIONING
```

Kontrak HMAC v2.7 antara Gateway dan PostgreSQL Branch A telah diverifikasi secara mendalam dan dinyatakan **100% kompatibel**. Seluruh prasyarat teknis, batasan hak akses tabel, dan prosedur injeksi terkendali telah dirancang secara aman. Tidak ada tindakan provisioning aktual yang dijalankan pada fase ini; sistem siap untuk eksekusi saat pengguna memberikan persetujuan eksplisit.
