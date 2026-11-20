# NEXUS HR — PHASE 4.5.5: SECURE LOCAL HMAC PROVISIONER SPECIFICATION (REMEDIATED)
**Target Workspace:** `D:\Antigravity_Projects\nexus-hr`  
**Target Database:** Branch A (`nexus-branch-a` | Project Ref: `uneycmbqqpkifwhwzbes`)  
**Target Table:** `nexus_internal.gateway_signing_keys`  
**Planned Key ID:** `gw-hmac-v1`  
**Date:** 2026-11-17  
**Status Remidiasi:** **REMEDIATED & SECURITY HARDENED**  
**Klasifikasi Akhir:** **`READY FOR EXPLICIT PROVISIONING APPROVAL`**

---

## 1. EXECUTIVE SUMMARY

Utilitas provisioning HMAC lokal `gateway/scripts/provision-hmac.ts` telah diremediasi sepenuhnya untuk mengatasi seluruh temuan dari audit independen Phase 4.5.6:
1. **TLS Certificate Verification Enforced (VULN-01):** Opsi `rejectUnauthorized: true` diwajibkan secara mutlak tanpa mekanisme bypass, menjamin keaslian sertifikat publik server Branch A (Let's Encrypt).
2. **Exact Host & URL Parsing (VULN-02):** Validasi connection string menggunakan objek `URL` native dengan verifikasi hostname presisi (hanya `db.uneycmbqqpkifwhwzbes.supabase.co` atau `*.pooler.supabase.com` dengan user `postgres.uneycmbqqpkifwhwzbes`). Central (`wcmevigbqsmzsdqidjel`), localhost, IP address, dan legacy projects (`bolt`, `cbt`, `nusantara`) ditolak secara fail-closed.
3. **Guaranteed Connection Cleanup (VULN-03):** Blok `finally { await client.end().catch(() => {}); }` diterapkan pada mode PREVIEW maupun EXECUTE.
4. **OS-Level Windows NTFS ACLs (VULN-04):** Pengaturan hak akses file `gateway/.env` dan file backup sementara menggunakan utilitas `icacls` Windows (`/inheritance:r /grant:r "%USERNAME%:F"`).
5. **Secret Sanitization (WARN-05):** Pembersihan menyeluruh terhadap pesan error konsol menggunakan regex scrubber untuk secret hex 64-karakter, JWT, password, dan bearer token.
6. **Key Overwrite Elimination (WARN-06):** Flag `--force` telah dihapus sepenuhnya; penimpaan kunci aktif di tempat dilarang.
7. **Crash Consistency & Recovery (WARN-07):** Deteksi backup terlantar (*orphaned backups*) saat startup dan instruksi pemulihan jika terjadi kegagalan asimetris (*split-state*).

---

## 2. FILE YANG DIUBAH DAN DITAMBAHKAN

| Path File | Aksi | Deskripsi |
| :--- | :--- | :--- |
| `gateway/scripts/provision-hmac.ts` | **Remediated** | Penerapan strict TLS, exact host validation, Windows ACLs, error scrubber, dan penghapusan `--force`. |
| `gateway/src/__tests__/provision-hmac.test.ts` | **Created** | 15 unit test komprehensif memvalidasi seluruh mitigasi keamanan (100% PASS). |
| `docs/architecture/phase_4_5/HMAC_PROVISIONER.md` | **Updated** | Spesifikasi teknis yang diselaraskan dengan hasil remediasi. |
| `docs/architecture/phase_4_5/HMAC_PROVISIONER_REMEDIATION.md` | **Created** | Laporan audit remediasi mendalam sesuai standar Phase 4.5.7. |

---

## 3. CARA KERJA MODE PREVIEW DAN EXECUTE

### 3.1. Mode PREVIEW (`npm run provision:preview`)
Mode default (read-only) untuk verifikasi kesiapan pra-provisioning:
- **Pemeriksaan Driver:** Memvalidasi ketersediaan package `pg`.
- **Pemeriksaan Proteksi Git:** Memastikan file `.env` dan `.env.*` diabaikan oleh `.gitignore`.
- **Deteksi Backup Terlantar:** Memeriksa keberadaan file `.env.bak.*` atau `.env.tmp.*`.
- **Pemeriksaan Target Database:** Memvalidasi connection string secara exact; menolak Central, IP, atau localhost.
- **Pemeriksaan Database (Read-Only):** Menghubungkan ke Branch A via TLS (`rejectUnauthorized: true`) untuk memeriksa keberadaan `gw-hmac-v1`.
- **Pembersihan Koneksi:** `client.end()` selalu dieksekusi di blok `finally`.

### 3.2. Mode EXECUTE (`npm run provision:execute`)
Mode eksekusi aktif yang hanya berjalan dengan otorisasi eksplisit operator:
- **Safety Gate 1:** Mewajibkan flag CLI `--confirm-safety`.
- **Safety Gate 2:** Mewajibkan environment variable `NEXUS_ALLOW_HMAC_PROVISION=true`.
- **Safety Gate 3:** Memvalidasi bahwa connection string strictly terdaftar untuk Branch A (`uneycmbqqpkifwhwzbes`).
- **Urutan Transaksional Terlindungi:**
  1. Koneksi TLS dengan verifikasi sertifikat aktif (`rejectUnauthorized: true`).
  2. Membuka transaksi PostgreSQL: `BEGIN`.
  3. Memeriksa keberadaan tabel `nexus_internal.gateway_signing_keys`.
  4. Memeriksa keberadaan key ID (menolak jika key sudah ada; tidak ada overwrite in-place).
  5. Menghasilkan secret 256-bit CSPRNG (`randomBytes(32).toString('hex')`).
  6. Parameterized query: `INSERT INTO nexus_internal.gateway_signing_keys (...) VALUES ($1, $2, ...)`.
  7. Membuat backup `gateway/.env` dengan ACL NTFS terbatas (`icacls`).
  8. Menulis konfigurasi baru ke `gateway/.env` via file sementara ber-ACL ketat.
  9. Memverifikasi isi `gateway/.env` sebelum commit database.
  10. Eksekusi `COMMIT` database dan penghapusan file backup sementara.
  11. Menampilkan metadata non-sensitif (`key_id`, status, timestamp aktivasi).

---

## 4. PERSYARATAN KONEKSI POSTGRESQL & KEAMANAN TRANSPORT

1. **Variabel Lingkungan Operator:**
   ```bash
   # Session Pooler (Port 5432):
   $env:BRANCH_A_DIRECT_DB_URL="postgresql://postgres.uneycmbqqpkifwhwzbes:[DB_PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"

   # Atau Direct Connection:
   $env:BRANCH_A_DIRECT_DB_URL="postgresql://postgres:[DB_PASSWORD]@db.uneycmbqqpkifwhwzbes.supabase.co:5432/postgres"
   ```
2. **Strict TLS Enforced:**
   Konfigurasi driver PostgreSQL mewajibkan verifikasi rantai sertifikat server:
   ```typescript
   ssl: {
     rejectUnauthorized: true,
   }
   ```
3. **Penyaringan Output (Scrubbing):**
   Semua pesan error disaring melalui `sanitizeErrorMessage()`, menyamarkan password, connection string, JWT, dan 64-hex secrets.

---

## 5. MEKANISME PROTEKSI FILE OS (WINDOWS NTFS ACLs)

Pada sistem operasi Windows, utilitas menerapkan pembatasan hak akses DACL melalui `icacls.exe`:
- Memutus pewarisan hak akses dari parent directory (`/inheritance:r`).
- Memberikan hak penuh (*Full Control*) khusus untuk pengguna Windows yang sedang aktif (`/grant:r "%USERNAME%:F"`).
- Memverifikasi keberhasilan ACL sebelum mengizinkan penulisan file selesai.

---

## 6. HASIL PENGUJIAN REGRESI & SECURITY REMEDIATION

Seluruh 59 test suite Gateway dan provisioner berhasil lulus 100%:
```
▶ HMAC Provisioner Security Remediation Tests
  ✔ accepts valid Branch A direct connection URL (7.0904ms)
  ✔ accepts valid Branch A session pooler connection URL (0.6991ms)
  ✔ rejects Central direct connection URL (3.103ms)
  ✔ rejects Central pooler connection URL (1.4978ms)
  ✔ rejects Central host attempting query parameter disguise with Branch A ref (0.7086ms)
  ✔ rejects localhost connection URL (0.5555ms)
  ✔ rejects IPv4 connection URL (0.525ms)
  ✔ rejects legacy project connection URLs (bolt, cbt, nusantara) (0.7764ms)
  ✔ configures PostgreSQL client with strict TLS certificate verification (rejectUnauthorized: true) (0.7251ms)
  ✔ guarantees client.end() is called when query execution fails in try/finally (0.8994ms)
  ✔ sanitizes 64-character hex secrets, passwords, and JWT tokens from error output (1.453ms)
  ✔ strictly rejects --force flag to prohibit in-place active key overwrite (1.4609ms)
  ✔ confirms unit test executions perform zero network, database, or filesystem writes (0.2903ms)
  ✔ fails closed when strict file ACL cannot be applied (0.6256ms)
  ✔ successfully applies restricted ACL to a local temporary file on current OS (151.0986ms)
✔ HMAC Provisioner Security Remediation Tests (180.0548ms)

Total: 59 passing, 0 failing
```

---

## 7. KLASIFIKASI AKHIR

```
READY FOR EXPLICIT PROVISIONING APPROVAL
```
