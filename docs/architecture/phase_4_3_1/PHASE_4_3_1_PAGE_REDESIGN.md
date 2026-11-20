# NEXUS HR — PHASE 4.3.1: PAGE-BY-PAGE REDESIGN AUDIT

## 1. Redesign Overview

Every page of the NEXUS HR web application was reviewed and rebuilt to replace generic AI-generated card layouts with a cohesive, information-dense, enterprise-grade design system.

---

## 2. Page Redesign Details

### A. Halaman Masuk (`LoginPage.tsx`)
- **Visual Design:** Dark navy slate canvas (`bg-slate-900`) with subtle radial grid background. Centered card with crisp border (`border-slate-700/80`) and backdrop blur.
- **Form Controls:** Corporate email and password inputs with custom toggle visibility (`Eye`/`EyeOff`), and clear field labels in Indonesian.
- **Demonstration Mode Panel:** Distinct bottom panel clearly demarcated as *"Akses Demo Cepat"* with instant-login buttons for:
  1. *Alexander Wright* (Superadmin Pusat)
  2. *Dewi Lestari* (Manajer Cabang A)
  3. *Budi Santoso* (Karyawan)
- **Security Compliance:** Footer note confirming HMAC SHA-256 v2.7 protocol enforcement and PostgreSQL 17.11 compatibility.

### B. Dasbor Eksekutif (`OverviewPage.tsx`)
- **Welcome Banner:** Dynamic heading addressing the user by name with role badge and branch node identity.
- **4 Compact KPI Cards:** Total Staf Aktif (68), Hadir Hari Ini (59, 94.2% Ketepatan), Terlambat (5), and Cuti Aktif (2). Replaced oversized cards with compact 12px-radius cards.
- **7-Day Attendance Trend:** Interactive bar visualizer rendering daily operational presence, late arrivals, and leaves with Indonesian day abbreviations (`Sen`, `Sel`, `Rab`, `Kam`, `Jum`, `Sab`, `Min`).
- **Alokasi Departemen:** Progress bars showing staffing percentage across 5 key corporate divisions.
- **Aktivitas Terkini:** Real-time log of recent employee presences and leave decisions with relative timestamps (`12 menit lalu`, `2 jam lalu`).

### C. Data Karyawan (`EmployeesPage.tsx`)
- **Data Table:** Tabular layout with responsive horizontal scroll wrapper (`min-w-160`).
- **Search & Filter:** Dual toolbar supporting text search across name, NIK, and email, alongside department dropdown filtering.
- **Status Badges:** Distinct semantic badges (`Karyawan Tetap`, `Kontrak (PKWT)`, `Masa Percobaan`, `Magang`).
- **Modal Tambah Karyawan:** Full form with validation for name, corporate email, phone, department, position, status, and join date.
- **Pagination:** Clean footer showing current page and total active records.

### D. Departemen & Struktur Jabatan (`DepartmentsPage.tsx`)
- **Tabbed View:** Toggle between *"Departemen"* (organizational divisions) and *"Posisi Jabatan"* (job grades).
- **Division Cards:** Grid of department cards displaying code badges, active status, headcount counter, and scope descriptions.
- **Job Positions Table:** Structured table linking each position to its parent department with live staff count.
- **Creation Modals:** Distinct modals for creating new departments and mapping new job positions.

### E. Konfigurasi Shift Kerja (`ShiftsPage.tsx`)
- **Shift Cards:** Clean visual cards presenting shift codes (`REG-PAGI`, `OPS-AWAL`, `SIANG-SORE`, `MALAM-INFRA`), working hours in 24-hour format, and break allowances in minutes.
- **Overnight Indicators:** Moon icon and warning tag highlighting overnight shifts that cross midnight.
- **Modal Template Shift:** Configurable form with midnight-crossing checkbox and break duration limits.

### F. Jadwal & Roster Kerja (`SchedulesPage.tsx`)
- **Roster Cards:** Weekly duty cards displaying calendar date, assigned employee NIK, shift time badge, and supervisor notes.
- **Role Isolation:** Employees only view their own upcoming shifts; managers can filter across all branch personnel.
- **Modal Penugasan Shift:** Supervisor modal for allocating shifts to employees with custom operational notes.

### G. Pencatatan Kehadiran & Log Absensi (`AttendancePage.tsx`)
- **Live WIB Clock Widget:** Real-time ticking 24-hour clock displaying current Indonesian Western Time (`Asia/Jakarta`).
- **Interactive Presensi Masuk:** One-click action recording verified check-in with loading state and immediate table update.
- **Audit Verification Badges:** Highlights records verified with cryptographic HMAC signatures.
- **Ekspor CSV:** Generates RFC 4180 compliant CSV file with UTF-8 BOM encoding for seamless Microsoft Excel compatibility.

### H. Pengajuan & Persetujuan Cuti (`LeavesPage.tsx`)
- **Status Filter Toolbar:** Quick filter buttons for `Semua Status`, `Menunggu`, `Disetujui`, and `Ditolak`.
- **Formulir Pengajuan Cuti:** Date pickers with working days calculation and mandatory justification text.
- **Tinjau Permohonan Cuti:** Reviewer dialog for managers to approve or reject with mandatory rejection reasons.
- **Self-Approval Prohibition:** Strictly enforces the PostgreSQL v2.7.1 security rule (`rpc_branch_decide_leave_request`). When a Branch Manager views their own leave request, the action button displays as *"Permohonan Mandiri"* and decision buttons are disabled with an explicit Indonesian security banner.

### I. Laporan Analitik & Kepatuhan SDM (`ReportsPage.tsx`)
- **KPI Metrics:** Total Tenaga Kerja, Tingkat Kehadiran, Skor Ketepatan, and Penggunaan Cuti.
- **Month Picker:** Period selection filter for monthly compliance reporting.
- **Ekspor CSV:** Downloads comprehensive executive report including department distribution and daily operational trends.
- **Cetak Laporan:** Dedicated print layout configured via `@media print` with clean contrast and suppressed navigation elements.

### J. Manajemen Pengguna & Akses IAM (`UserManagementPage.tsx`)
- **Access Guard:** Displays a locked barrier for non-SUPERADMIN roles.
- **IAM Directory:** User avatars, full name, email, system role, node jurisdiction, last login timestamp, and status.
- **Status Toggle:** Action button to suspend or activate accounts (with safeguard against self-suspension).
- **Security Notice:** Banner citing audit logging rules under PostgreSQL v2.7.1.

### K. Pengaturan Sistem & Telemetri Node (`SettingsPage.tsx`)
- **Distributed Node Topology:** Telemetry indicators for Central DB (`wcmevigbqsmzsdqidjel`) and Branch A Node (`uneycmbqqpkifwhwzbes`), both operating on PostgreSQL 17.11.
- **Security Specifications:** Displays HMAC-SHA256 v2.7 protocol, 300-second anti-replay nonce window, and `tx_actor_context` parameters.
- **Password Update:** Form to update security credentials with validation.
- **Atur Ulang Data Demo:** Action button to flush browser `localStorage` and reset mock state.
