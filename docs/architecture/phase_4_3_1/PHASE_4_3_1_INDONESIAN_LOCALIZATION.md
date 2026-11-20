# NEXUS HR — PHASE 4.3.1: INDONESIAN LOCALIZATION SPECIFICATION

## 1. Overview & Localization Policy

NEXUS HR Enterprise has been fully localized into **Bahasa Indonesia** across all user-facing interfaces, ensuring natural, idiomatic terminology suitable for Indonesian corporate HR operations, labor regulations (UU Ketenagakerjaan / PKWT), and enterprise reporting.

---

## 2. Terminology Glossary & Translation Mapping

### 2.1 Navigation & Main Modules
| English Label | Indonesian Localization | Context |
| :--- | :--- | :--- |
| Dashboard / Overview | **Ringkasan** | Dasbor metrik eksekutif |
| Employees | **Data Karyawan** | Direktori & profil staf |
| Departments | **Departemen & Jabatan** | Struktur hierarki divisi |
| Shifts | **Shift Kerja** | Konfigurasi waktu kerja |
| Schedules | **Jadwal Kerja** | Perencanaan roster mingguan |
| Attendance | **Kehadiran** | Log presensi harian & biometrik |
| Leave Requests | **Pengajuan Cuti** | Permohonan & persetujuan izin |
| Reports | **Laporan Eksekutif** | Analitik kepatuhan SDM |
| User Management | **Manajemen Pengguna** | Administrasi IAM & otorisasi |
| Settings | **Pengaturan Sistem** | Konfigurasi node & keamanan |

### 2.2 Roles & Authorizations
| Code / Identifier | Indonesian Localization | Jurisdiksi |
| :--- | :--- | :--- |
| `SUPERADMIN` | **Superadmin Pusat** | Akses Penuh Sistem & IAM |
| `BRANCH_MANAGER` | **Manajer Cabang** | Operasional & Persetujuan Cabang A |
| `CENTRAL_HR` | **HR Pusat** | Personalia Korporat Global |
| `BRANCH_HR` | **HR Cabang** | Personalia & Roster Cabang |
| `EMPLOYEE` | **Karyawan** | Akses Mandiri (Self-Service) |

### 2.3 Status Presensi & Cuti
| System Code | Indonesian Label | Warna Indikator |
| :--- | :--- | :--- |
| `ON_TIME` | **Tepat Waktu** | Hijau Emerald |
| `LATE` | **Terlambat Masuk** | Kuning Amber |
| `ABSENT` | **Tidak Hadir** | Merah Rose |
| `EARLY_DEPARTURE` | **Pulang Cepat** | Oranye |
| `OVERTIME` | **Kerja Lembur** | Biru |
| `PENDING` | **Menunggu Persetujuan** | Kuning Amber |
| `APPROVED` | **Disetujui** | Hijau Emerald |
| `REJECTED` | **Ditolak** | Merah Rose |
| `SCHEDULED` | **Terjadwal** | Biru |
| `SWAPPED` | **Tukar Shift** | Ungu |
| `OFF` | **Hari Libur** | Abu-abu Slate |

### 2.4 Kategori Cuti & Hubungan Kerja
| Kategori Asli | Terjemahan Bahasa Indonesia |
| :--- | :--- |
| `ANNUAL` | **Cuti Tahunan (Hak Cuti Resmi)** |
| `SICK` | **Cuti Sakit / Surat Dokter** |
| `MATERNITY` | **Cuti Melahirkan** |
| `SPECIAL_PERMISSION` | **Izin Khusus / Keperluan Mendesak** |
| `UNPAID` | **Cuti di Luar Tanggungan** |
| `PERMANENT` | **Karyawan Tetap** |
| `CONTRACT` | **Kontrak (PKWT)** |
| `PROBATION` | **Masa Percobaan** |
| `INTERN` | **Magang** |

---

## 3. Formatting Standards

All formatting logic is centralized in [`src/utils/formatters.ts`](file:///D:/Antigravity_Projects/nexus-hr/frontend/src/utils/formatters.ts):
- **Tanggal Standar:** `DD MMMM YYYY` (contoh: `12 November 2026`) menggunakan locale `id-ID` dan zona waktu `Asia/Jakarta`.
- **Waktu Jam:** Format 24 Jam dengan sufiks zona waktu (contoh: `08:00 WIB` atau `07:54:12 WIB`).
- **Ekspor CSV:** Menggunakan awalan UTF-8 Byte Order Mark (`\uFEFF`) agar seluruh karakter khusus dan format tanggal terbuka secara sempurna di Microsoft Excel Indonesia.
- **Pesan Keamanan:** Seluruh dialog validasi dan peringatan audit (termasuk *Self-Approval Prohibition*) disajikan dalam Bahasa Indonesia yang formal dan tegas.
