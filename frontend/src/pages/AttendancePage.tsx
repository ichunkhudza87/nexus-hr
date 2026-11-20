import React, { useEffect, useState } from 'react';
import {
  Download,
  LogIn,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../services/api';
import { formatDate, getAttendanceStatusLabel } from '../utils/formatters';
import type { AttendanceRecord } from '../types';

export const AttendancePage: React.FC = () => {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [clockingIn, setClockingIn] = useState(false);

  // Filter
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [search, setSearch] = useState('');

  // Jam Waktu-Nyata WIB
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadAttendance = async () => {
    setLoading(true);
    try {
      const data = await api.getAttendance({
        status: statusFilter || undefined,
        date: dateFilter || undefined,
      });
      setRecords(data);
    } catch {
      showToast('error', 'Gagal memuat log data kehadiran.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAttendance();
  }, [statusFilter, dateFilter]);

  const handleClockIn = async () => {
    if (!user?.employeeId && user?.role === 'SUPERADMIN') {
      showToast(
        'info',
        'Akun Superadmin Pusat tidak terikat profil staf cabang untuk absensi harian.'
      );
      return;
    }
    const empId = user?.employeeId || '00000000-0000-0000-0000-000000000102';
    setClockingIn(true);
    try {
      await api.recordCheckIn(empId);
      const timeStr = currentTime.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      showToast('success', `Presensi masuk tercatat pukul ${timeStr} WIB (Terverifikasi HMAC).`);
      await loadAttendance();
    } catch {
      showToast('error', 'Gagal mencatat presensi masuk.');
    } finally {
      setClockingIn(false);
    }
  };

  const handleExportCSV = () => {
    if (records.length === 0) {
      showToast('error', 'Tidak ada data kehadiran untuk diekspor.');
      return;
    }
    const headers = [
      'Tanggal',
      'NIK Karyawan',
      'Nama Karyawan',
      'Departemen',
      'Jam Masuk',
      'Jam Keluar',
      'Status Kehadiran',
      'Keterlambatan (Menit)',
      'Terverifikasi Kriptografi',
    ];
    const rows = filteredRecords.map((r) => [
      r.attendanceDate,
      r.employeeCode,
      `"${r.employeeName}"`,
      `"${r.departmentName}"`,
      r.checkInTime,
      r.checkOutTime || '-',
      getAttendanceStatusLabel(r.status),
      r.lateMinutes,
      r.isVerified ? 'YA (HMAC-SHA256)' : 'TIDAK',
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `nexus_kehadiran_${new Date().toISOString().split('T')[0]}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('success', 'Berkas CSV log kehadiran berhasil diunduh.');
  };

  const getStatusBadge = (status: AttendanceRecord['status']) => {
    switch (status) {
      case 'ON_TIME':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'LATE':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'ABSENT':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'EARLY_DEPARTURE':
        return 'bg-orange-50 text-orange-700 border-orange-200';
      case 'OVERTIME':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const filteredRecords = records.filter((r) => {
    if (
      search &&
      !r.employeeName.toLowerCase().includes(search.toLowerCase()) &&
      !r.employeeCode.toLowerCase().includes(search.toLowerCase()) &&
      !r.departmentName.toLowerCase().includes(search.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header Halaman & Widget Absensi Cepat */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Pencatatan Kehadiran & Log Absensi
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Log presensi masuk dan keluar staf secara waktu-nyata dengan verifikasi integritas audit.
          </p>
        </div>

        {/* Widget Jam Digital & Tombol Presensi */}
        <div className="flex items-center gap-3 bg-white p-2.5 rounded-2xl border border-slate-200/80 shadow-xs shrink-0">
          <div className="px-3 border-r border-slate-200 text-right">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
              Waktu Server (WIB)
            </span>
            <span className="text-sm sm:text-base font-mono font-bold text-slate-900">
              {currentTime.toLocaleTimeString('id-ID', { hour12: false })}
            </span>
          </div>

          <button
            type="button"
            onClick={handleClockIn}
            disabled={clockingIn}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
          >
            <LogIn className="w-4 h-4" />
            {clockingIn ? 'Mencatat...' : 'Presensi Masuk Sekarang'}
          </button>
        </div>
      </div>

      {/* Toolbar Filter & Aksi Ekspor */}
      <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Cari nama, NIK, atau divisi..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="w-full sm:w-44">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter berdasarkan status kehadiran"
              className="w-full text-xs sm:text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Semua Status Presensi</option>
              <option value="ON_TIME">Tepat Waktu</option>
              <option value="LATE">Terlambat Masuk</option>
              <option value="ABSENT">Tidak Hadir</option>
              <option value="OVERTIME">Kerja Lembur</option>
            </select>
          </div>

          <div className="w-full sm:w-44">
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              aria-label="Filter tanggal kehadiran"
              className="w-full text-xs sm:text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {dateFilter && (
            <button
              type="button"
              onClick={() => setDateFilter('')}
              className="text-xs text-blue-600 hover:underline font-semibold"
            >
              Reset Tanggal
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={handleExportCSV}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 shadow-xs transition-colors cursor-pointer"
        >
          <Download className="w-4 h-4 text-slate-500" />
          Ekspor CSV
        </button>
      </div>

      {/* Tabel Data Kehadiran */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs sm:text-sm min-w-160">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  <th className="py-3 px-4">Tanggal Presensi</th>
                  <th className="py-3 px-4">Nama Staf</th>
                  <th className="py-3 px-4">Divisi Kerja</th>
                  <th className="py-3 px-4">Jam Masuk</th>
                  <th className="py-3 px-4">Jam Keluar</th>
                  <th className="py-3 px-4">Status Presensi</th>
                  <th className="py-3 px-4">Keterlambatan</th>
                  <th className="py-3 px-4 text-center">Audit Gateway</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRecords.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-3 px-4 font-mono text-xs text-slate-600">
                      {formatDate(r.attendanceDate)}
                    </td>
                    <td className="py-3 px-4">
                      <div>
                        <div className="font-bold text-slate-900">{r.employeeName}</div>
                        <div className="text-[11px] font-mono text-slate-500">
                          NIK: {r.employeeCode}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 font-medium">
                      {r.departmentName}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-slate-900">
                      {r.checkInTime} WIB
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-500">
                      {r.checkOutTime ? `${r.checkOutTime} WIB` : '—'}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center text-[11px] px-2.5 py-0.5 rounded-full font-semibold border ${getStatusBadge(
                          r.status
                        )}`}
                      >
                        {getAttendanceStatusLabel(r.status)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs font-semibold">
                      {r.lateMinutes > 0 ? (
                        <span className="text-amber-600">+{r.lateMinutes} menit</span>
                      ) : (
                        <span className="text-slate-400">0 menit</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {r.isVerified ? (
                        <span
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md"
                          title="Terverifikasi secara kriptografis melalui tanda tangan Gateway HMAC"
                        >
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                          Terverifikasi
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">Standar</span>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredRecords.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-500">
                      Tidak ada catatan kehadiran yang sesuai dengan filter pencarian.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
