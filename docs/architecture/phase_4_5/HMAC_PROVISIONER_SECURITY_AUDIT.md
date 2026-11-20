# NEXUS HR — PHASE 4.5.6: INDEPENDENT HMAC PROVISIONER SECURITY AUDIT REPORT
**Target Workspace:** `D:\Antigravity_Projects\nexus-hr`  
**Inspected Scope:**
- `gateway/scripts/provision-hmac.ts`
- `gateway/package.json`
- `gateway/.env.example`
- `.gitignore`
- `docs/architecture/phase_4_5/HMAC_PROVISIONER.md`
**Auditor Role:** Senior Independent Application Security Engineer & Database Security Architect  
**Audit Date:** 2026-11-17  
**Klasifikasi Akhir:** **`BLOCKED — SECURITY REMEDIATION REQUIRED`**

---

## 1. EXECUTIVE SUMMARY

Audit keamanan independen *read-only* telah dilakukan terhadap utilitas provisioning HMAC lokal `gateway/scripts/provision-hmac.ts` dan artefak konfigurasi terkait.

Audit menemukan bahwa arsitektur utilitas telah mengimplementasikan sejumlah pola keamanan mendasar yang baik (parameterized queries, isolasi mode preview, CSPRNG 256-bit, dan safety gates ganda). Namun, ditemukan **kelemahan kritis pada validasi sertifikat TLS**, **kebocoran koneksi (connection leak) pada penanganan error**, **validasi hostname yang rentan bypass**, serta **keterbatasan proteksi permission file pada sistem operasi Windows**.

Sesuai kriteria zero-trust, provisioning aktual **DIBLOKIR** sampai seluruh temuan keamanan diperbaiki.

---

## 2. HASIL AUDIT 12 FOKUS KRITIS

### 2.1. Validasi Mode PREVIEW (Poin 1)
- **Kode:** `gateway/scripts/provision-hmac.ts`, Baris 146–227 (`runPreview`).
- **Temuan:**
  - Fungsi `runPreview()` hanya melakukan pembacaan file lokal (`verifyGitIgnoreProtection`, `parseEnvFile`) dan eksekusi query SQL read-only `SELECT key_id, is_active, ... FROM nexus_internal.gateway_signing_keys WHERE key_id = $1` (Baris 202–207).
  - Tidak ada pemanggilan fungsi `randomBytes` di dalam `runPreview`.
  - Tidak ada fungsi penulisan file (`fs.writeFileSync`, `fs.copyFileSync`, `writeEnvSafely`).
  - Tidak ada statement DDL maupun DML (`INSERT`, `UPDATE`, `DELETE`).
- **Status:** **PASS**

---

### 2.2. Validasi Safety Gate Mode EXECUTE (Poin 2)
- **Kode:** `gateway/scripts/provision-hmac.ts`, Baris 234–244.
- **Bukti Baris:**
  ```typescript
  // Baris 235-238
  if (!opts.confirmSafety) {
    console.error('[BLOCKED] Missing safety flag: --confirm-safety is required to run in EXECUTE mode.');
    process.exit(1);
  }

  // Baris 240-243
  if (process.env.NEXUS_ALLOW_HMAC_PROVISION !== 'true') {
    console.error('[BLOCKED] Environment gate active: NEXUS_ALLOW_HMAC_PROVISION=true is required.');
    process.exit(1);
  }
  ```
- **Temuan:**
  Kedua safety gate diverifikasi secara independen sebelum inisialisasi koneksi database. Jika salah satu atau keduanya absen, proses langsung berhenti dengan exit code 1 (*fails closed*).
- **Status:** **PASS**

---

### 2.3. Validasi Target Database Branch A (Poin 3 & Poin 12)
- **Kode:** `gateway/scripts/provision-hmac.ts`, Baris 251–255.
- **Bukti Baris:**
  ```typescript
  // Baris 252-255
  if (!dbUrl.includes(EXPECTED_BRANCH_A_REF) && !dbUrl.includes('localhost')) {
    console.error(`[BLOCKED] Target database does not match expected Branch A reference (${EXPECTED_BRANCH_A_REF}).`);
    process.exit(1);
  }
  ```
- **Kelemahan Kritis Ditemukan (VULN-01):**
  1. **Bypass via String Substring:** Pengecekan menggunakan `dbUrl.includes(EXPECTED_BRANCH_A_REF)` dapat dikelabui jika connection string mengarah ke Central (`wcmevigbqsmzsdqidjel`) namun memuat parameter query atau database name palsu (misal: `postgresql://user:pass@wcmevigbqsmzsdqidjel.supabase.co:5432/postgres?ref=uneycmbqqpkifwhwzbes`). Host yang sebenarnya dihubungi adalah Central, namun lolos validasi.
  2. **Bypass via `localhost`:** Kondisi `!dbUrl.includes('localhost')` mengizinkan sembarang connection string localhost tanpa memverifikasi port atau database target.
  3. **Absennya Blacklist Central & Proyek Legacy:** Kode tidak secara eksplisit menolak referensi Central (`wcmevigbqsmzsdqidjel`) maupun proyek warisan (`bolt`, `cbt`, `nusantara`).
- **Status:** **FAIL — SECURITY VULNERABILITY**

---

### 2.4. Validasi Sertifikat Server TLS (Poin 4)
- **Kode:** `gateway/scripts/provision-hmac.ts`, Baris 193 dan Baris 260.
- **Bukti Baris:**
  ```typescript
  // Baris 193 (runPreview)
  ssl: { rejectUnauthorized: false }, // TLS enabled

  // Baris 260 (runExecute)
  ssl: { rejectUnauthorized: false }, // TLS mandatory
  ```
- **Kelemahan Kritis Ditemukan (VULN-02):**
  - Opsi `rejectUnauthorized: false` secara sengaja **menonaktifkan verifikasi sertifikat server**.
  - Hal ini membuka celah fatal terhadap serangan *Man-in-the-Middle* (MITM). Penyerang di jalur jaringan (DNS spoofing, rogue gateway, proxy kompromis) dapat menyamar sebagai server PostgreSQL, menerima koneksi TLS tanpa validasi CA, dan menangkap kredensial database serta HMAC secret yang dikirimkan.
  - Infrastruktur Supabase (Pooler maupun Direct Connection) menggunakan sertifikat resmi yang valid dari Let's Encrypt. Menonaktifkan verifikasi sertifikat melanggar standar keamanan TLS enterprise.
- **Status:** **FAIL — CRITICAL VULNERABILITY**

---

### 2.5. Parameterized Query INSERT (Poin 5)
- **Kode:** `gateway/scripts/provision-hmac.ts`, Baris 302–323.
- **Bukti Baris:**
  ```typescript
  const insertRes = await client.query(
    `INSERT INTO nexus_internal.gateway_signing_keys (
       key_id, hmac_secret, is_active, activated_at, created_at, rotated_at, expires_at, revoked_at
     ) VALUES (
       $1, $2, TRUE, now(), now(), NULL, NULL, NULL
     )
     ON CONFLICT (key_id) DO UPDATE SET ...
     RETURNING key_id, is_active, activated_at`,
    [opts.keyId, secret]
  );
  ```
- **Temuan:**
  Statement SQL menggunakan parameter positional native `$1` dan `$2`. Nilai secret dan keyId dikirimkan secara terpisah via protokol PostgreSQL binary/text parameter, mencegah SQL injection dan mencegah secret masuk ke riwayat teks kueri PostgreSQL.
- **Status:** **PASS**

---

### 2.6. Kebocoran Secret pada Log, Exception, dan Dokumentasi (Poin 6)
- **Kode:** `gateway/scripts/provision-hmac.ts`, Baris 56–66, 361–370, 372–374.
- **Bukti Baris:**
  ```typescript
  // Baris 372-373
  const errorMsg = err instanceof Error ? err.message : String(err);
  console.error(`\n[ERROR] Provisioning failed: ${errorMsg}`);
  ```
- **Kelemahan Potensial Ditemukan (VULN-03):**
  - Fungsi `maskConnectionString()` telah menyamarkan password URL dengan `********`.
  - Pada blok `catch`, pesan `errorMsg` dicetak langsung ke konsol. Apabila driver `pg` atau server PostgreSQL mengembalikan pesan kesalahan yang memuat `DETAIL: Key (hmac_secret)=(...)` (misalnya pada pelanggaran constraint atau custom exception PL/pgSQL), substring secret dapat bocor ke terminal log.
  - Tidak ada filter sanitasi regex (scrubber) yang menghapus pola 64-hex string sebelum dicetak ke stderr.
- **Status:** **WARN / REMEDIATION REQUIRED**

---

### 2.7. Proteksi Terhadap Penimpaan Kunci Aktif (Poin 7)
- **Kode:** `gateway/scripts/provision-hmac.ts`, Baris 285–292.
- **Bukti Baris:**
  ```typescript
  // Baris 285-292
  const existingCheck = await client.query(
    `SELECT key_id, is_active FROM nexus_internal.gateway_signing_keys WHERE key_id = $1`,
    [opts.keyId]
  );

  if (existingCheck.rows.length > 0 && !opts.forceOverwrite) {
    throw new Error(`Key '${opts.keyId}' already exists in database. Use --force to rotate or overwrite.`);
  }
  ```
- **Kelemahan Ditemukan (VULN-04):**
  - Skrip menolak eksekusi jika `key_id` sudah ada tanpa flag `--force`.
  - Namun jika `--force` digunakan, statement `ON CONFLICT (key_id) DO UPDATE SET hmac_secret = EXCLUDED.hmac_secret` (Baris 315–320) akan **menimpa secret kunci yang ada secara langsung di tempat** (*in-place overwrite*).
  - Pada arsitektur zero-downtime NEXUS HR (`hmac-signer.ts`), rotasi kunci wajib mendemotasikan kunci lama menjadi `rotated_at = now()` dengan grace period (`expires_at`), bukan menghapus/menimpa secret lama seketika. Penimpaan langsung akan membatalkan seluruh amplop transaksi in-flight yang sedang diproses.
- **Status:** **WARN / REMEDIATION REQUIRED**

---

### 2.8. Urutan Transaksi dan Konsistensi Rollback (Poin 8 & Poin 9)
- **Kode:** `gateway/scripts/provision-hmac.ts`, Baris 272–395.
- **Analisis Urutan Eksekusi:**
  1. `await client.query('BEGIN')` (Baris 273)
  2. `INSERT` ke database (Baris 302)
  3. Backup `.env` ke `.env.bak.<timestamp>` (Baris 332)
  4. Penulisan atomik `.env` lokal (Baris 337)
  5. Verifikasi reload `.env` lokal (Baris 343)
  6. `await client.query('COMMIT')` (Baris 354)
  7. Penghapusan file backup (Baris 358)
- **Evaluasi Titik Kegagalan (Failure Scenarios):**
  - **Skenario A (File Berhasil Ditulis, tetapi COMMIT Gagal):**  
    Jika `COMMIT` pada baris 354 gagal (misal: koneksi terputus atau constraint deferred gagal), blok `catch` berjalan: `ROLLBACK` database dieksekusi, dan `fs.copyFileSync(backupEnvPath, ENV_PATH)` memulihkan `.env` semula.
    *Celah Risiko:* Jika terjadi crash mendadak (SIGKILL / power outage) tepat setelah baris 337 dan sebelum baris 354, PostgreSQL otomatis me-rollback transaksi yang belum di-commit, tetapi file `.env` lokal tetap tertinggal dengan secret baru. Akibatnya, `.env` lokal dan database mengalami *desynchronization* (split-state).
  - **Skenario B (COMMIT Berhasil, Proses Terhenti Sebelum Backup Dihapus):**  
    Jika proses terhenti pada baris 355 sebelum baris 358 dieksekusi, file `.env.bak.<timestamp>` tertinggal di filesystem. Meskipun `.gitignore` melindungi `.env.*`, file backup yang memuat secret mentah tertinggal tanpa pembersihan otomatis saat startup.
  - **Skenario C (Pemulihan `.env` Gagal pada Catch Block):**  
    Pada baris 387, jika `fs.copyFileSync` gagal (misal: antivirus lock di Windows atau disk error), skrip hanya mencatat error ke `console.error` dan keluar, meninggalkan file `.env` dalam kondisi tidak sinkron dengan database yang telah di-rollback.
- **Status:** **WARN / REMEDIATION REQUIRED**

---

### 2.9. Permission File pada Sistem Operasi Host (Poin 10)
- **Kode:** `gateway/scripts/provision-hmac.ts`, Baris 131–133.
- **Bukti Baris:**
  ```typescript
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tempPath, newLines.join('\n'), { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
  ```
- **Kelemahan Kritis Ditemukan (VULN-05):**
  - Host lingkungan pengguna adalah **Windows (PowerShell / NTFS)**.
  - Di sistem operasi Windows, parameter POSIX `{ mode: 0o600 }` pada `fs.writeFileSync` **TIDAK MENGATUR Windows Access Control List (DACL)**. Mode octal di Node.js pada Windows hanya mengontrol bit *read-only* file, bukan hak akses user/grup.
  - Akibatnya, file `gateway/.env` yang baru ditulis tetap mewarisi DACL dari parent folder `gateway/`, yang umumnya memberikan hak baca (*Read*) kepada `BUILTIN\Users` atau akun lain pada sistem lokal.
  - Untuk membatasi akses file di Windows, diperlukan pengaturan eksplisit menggunakan utilitas `icacls` (misal: menghapus inheritansi dan membatasi hanya untuk `CURRENT_USER`).
- **Status:** **FAIL — SECURITY VULNERABILITY (OS-SPECIFIC)**

---

### 2.10. Penutupan Koneksi dan Transaksi (Poin 11)
- **Kode:** `gateway/scripts/provision-hmac.ts`, Baris 197–219 (`runPreview`) dan Baris 271–398 (`runExecute`).
- **Kelemahan Ditemukan (VULN-06):**
  - Pada `runExecute`, penutupan koneksi ditangani secara benar menggunakan blok `finally { await client.end(); }` (Baris 397).
  - Namun pada `runPreview` (Baris 197–219):
    ```typescript
    try {
      await client.connect();
      ...
      await client.end(); // Baris 215
    } catch (dbErr: unknown) {
      // Baris 216-219
    }
    ```
    Jika pemanggilan `client.query()` pada baris 202 melempar exception (misal: timeout atau hak akses ditolak), baris 215 **tidak pernah dieksekusi**, dan tidak ada blok `finally`. Koneksi PostgreSQL menggantung (*leaked socket*) sampai garbage collection atau proses selesai.
- **Status:** **FAIL — RESOURCE LEAK DEFECT**

---

## 3. AUDIT ARTEFAK PENDUKUNG

### 3.1. `gateway/package.json`
- Dependensi `pg` (`^8.23.1`) dan `@types/pg` (`^8.23.1`) telah ditambahkan dengan benar.
- Script shortcut terdaftar:
  - `"provision:preview": "node scripts/provision-hmac.ts --preview"`
  - `"provision:execute": "node scripts/provision-hmac.ts --execute"`
- Tidak ditemukan malicious dependencies atau script lifecycle hooks yang mencurigakan.
- Status: **PASS**

### 3.2. `.gitignore`
- File `D:\Antigravity_Projects\nexus-hr\.gitignore` memuat aturan:
  - `.env`
  - `.env.*`
  - `!.env.example`
- Aturan `.env.*` secara efektif melindungi file backup sementara seperti `.env.bak.<timestamp>` dan `.env.tmp.<timestamp>` dari pelacakan git.
- Status: **PASS**

### 3.3. `gateway/.env.example`
- Memuat template variabel lingkungan tanpa HMAC secret produksi (`GATEWAY_ACTOR_HMAC_KEY=insert_256bit_hex_secret_min_32_bytes_here`).
- Nilai token service role di `.env.example` merupakan format dummy token standar development.
- Status: **PASS**

### 3.4. `docs/architecture/phase_4_5/HMAC_PROVISIONER.md`
- Dokumentasi secara akurat menggambarkan arsitektur utilitas.
- Namun, pada Bagian 4 butir 2, dokumen menyatakan `ssl: { rejectUnauthorized: false }` sebagai "Koneksi TLS Mandatory", yang melegitimasi penonaktifan verifikasi sertifikat server. Bagian ini wajib direvisi setelah remediasi TLS.
- Status: **DOC DRIFT / REVISION REQUIRED**

---

## 4. MATRIKS TEMUAN KEAMANAN & DAFTAR REMEDIASI

| ID Temuan | Kategori | Tingkat Keparahan | Lokasi Kode | Deskripsi Masalah | Rekomendasi Remediasi |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **VULN-01** | Validasi Host | **HIGH** | `provision-hmac.ts`: 251–255 | Menggunakan `.includes()` rentan bypass URL dan mengizinkan `localhost`. | Parse URL menggunakan `new URL()`, validasi `hostname` tepat `uneycmbqqpkifwhwzbes.supabase.co` atau session pooler resmi; tolak eksplisit Central dan legacy refs (`bolt`, `cbt`, `nusantara`). |
| **VULN-02** | Keamanan Transport | **CRITICAL** | `provision-hmac.ts`: 193, 260 | `rejectUnauthorized: false` mematikan validasi sertifikat server TLS. | Wajibkan `rejectUnauthorized: true` secara default, dukung `ca` kustom via environment variable `PGSSLROOTCERT` jika diperlukan. |
| **VULN-03** | Pencegahan Kebocoran | **MEDIUM** | `provision-hmac.ts`: 372–374 | Output error di konsol tidak menyaring pola hex secret 64-karakter. | Tambahkan fungsi sanitasi regex sebelum pesan error dicetak (`msg.replace(/[0-9a-fA-F]{64}/g, '[REDACTED_SECRET]')`). |
| **VULN-04** | Manajemen Kunci | **MEDIUM** | `provision-hmac.ts`: 290–320 | Flag `--force` menimpa kunci aktif secara langsung di tempat (*in-place overwrite*). | Tolak overwrite langsung pada kunci aktif; gunakan model rotasi bertahap atau kunci baru jika keyId berbeda. |
| **VULN-05** | Proteksi File OS | **HIGH** | `provision-hmac.ts`: 131–133 | `mode: 0o600` tidak efektif pada sistem file Windows NTFS. | Terapkan pembatasan ACL Windows via `icacls` pada Windows OS (`icacls <file> /inheritance:r /grant:r "%USERNAME%:F"`). |
| **VULN-06** | Manajemen Resource | **LOW** | `provision-hmac.ts`: 197–219 | `runPreview` membocorkan koneksi jika query gagal (absen `finally`). | Pindahkan `await client.end()` ke dalam blok `finally`. |

---

## 5. KLASIFIKASI HASIL AKHIR

```
BLOCKED — SECURITY REMEDIATION REQUIRED
```

Provisioning HMAC aktual ke remote database **DIBLOKIR**. Sebelum mode EXECUTE diizinkan berjalan, seluruh 6 temuan remediasi keamanan di atas wajib diselesaikan dan diverifikasi ulang.
