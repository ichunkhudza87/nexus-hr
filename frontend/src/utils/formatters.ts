import type {
  AttendanceStatus,
  EmploymentStatus,
  LeaveStatus,
  LeaveType,
  ScheduleStatus,
  UserRole,
} from '../types';

/**
 * Format tanggal dalam format Bahasa Indonesia (DD MMMM YYYY)
 * Contoh: 2026-11-12 -> 12 November 2026
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Jakarta',
    }).format(d);
  } catch {
    return dateStr;
  }
}

/**
 * Format tanggal ringkas (DD MMM YYYY)
 * Contoh: 12 Nov 2026
 */
export function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Jakarta',
    }).format(d);
  } catch {
    return dateStr;
  }
}

/**
 * Format tanggal dan waktu lengkap
 * Contoh: 12 Nov 2026, 08:30 WIB
 */
export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const formatted = new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Jakarta',
    }).format(d);
    return `${formatted} WIB`;
  } catch {
    return dateStr;
  }
}

/**
 * Label Peran Pengguna (User Role)
 */
export function getRoleLabel(role: UserRole | string | undefined): string {
  switch (role) {
    case 'SUPERADMIN':
      return 'Superadmin Pusat';
    case 'BRANCH_MANAGER':
      return 'Manajer Cabang';
    case 'CENTRAL_HR':
      return 'HR Pusat';
    case 'BRANCH_HR':
      return 'HR Cabang';
    case 'EMPLOYEE':
      return 'Karyawan';
    default:
      return role || 'Pengguna';
  }
}

/**
 * Label Status Kepegawaian
 */
export function getEmploymentStatusLabel(status: EmploymentStatus | string): string {
  switch (status) {
    case 'PERMANENT':
      return 'Karyawan Tetap';
    case 'CONTRACT':
      return 'Kontrak (PKWT)';
    case 'INTERN':
      return 'Magang';
    case 'PROBATION':
      return 'Masa Percobaan';
    default:
      return status;
  }
}

/**
 * Label Jenis Cuti
 */
export function getLeaveTypeLabel(type: LeaveType | string): string {
  switch (type) {
    case 'ANNUAL':
      return 'Cuti Tahunan';
    case 'SICK':
      return 'Cuti Sakit';
    case 'MATERNITY':
      return 'Cuti Melahirkan';
    case 'UNPAID':
      return 'Cuti di Luar Tanggungan';
    case 'SPECIAL_PERMISSION':
      return 'Izin Khusus / Darurat';
    default:
      return type;
  }
}

/**
 * Label Status Pengajuan Cuti
 */
export function getLeaveStatusLabel(status: LeaveStatus | string): string {
  switch (status) {
    case 'PENDING':
      return 'Menunggu Persetujuan';
    case 'APPROVED':
      return 'Disetujui';
    case 'REJECTED':
      return 'Ditolak';
    case 'CANCELLED':
      return 'Dibatalkan';
    default:
      return status;
  }
}

/**
 * Label Status Jadwal Kerja
 */
export function getScheduleStatusLabel(status: ScheduleStatus | string): string {
  switch (status) {
    case 'SCHEDULED':
      return 'Terjadwal';
    case 'SWAPPED':
      return 'Tukar Shift';
    case 'CANCELLED':
      return 'Dibatalkan';
    case 'LEAVE':
      return 'Sedang Cuti';
    case 'OFF':
      return 'Hari Libur';
    default:
      return status;
  }
}

/**
 * Label Status Kehadiran
 */
export function getAttendanceStatusLabel(status: AttendanceStatus | string): string {
  switch (status) {
    case 'ON_TIME':
      return 'Tepat Waktu';
    case 'LATE':
      return 'Terlambat';
    case 'EARLY_DEPARTURE':
      return 'Pulang Cepat';
    case 'OVERTIME':
      return 'Lembur';
    case 'INCOMPLETE':
      return 'Tidak Lengkap';
    case 'ABSENT':
      return 'Tidak Hadir';
    default:
      return status;
  }
}
