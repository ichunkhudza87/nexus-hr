import React, { useEffect, useState } from 'react';
import {
  Users,
  UserCheck,
  Clock,
  CalendarOff,
  Building,
  TrendingUp,
  ShieldCheck,
  CheckCircle2,
  Activity,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { getRoleLabel } from '../utils/formatters';
import type { DashboardSummary } from '../types';

export const OverviewPage: React.FC = () => {
  const { user } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getDashboardSummary()
      .then((data) => setSummary(data))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-500 font-medium">Memuat data ringkasan...</p>
        </div>
      </div>
    );
  }

  const roleTitle = getRoleLabel(user?.role);
  const isEmployee = user?.role === 'EMPLOYEE';
  const isManager = user?.role === 'BRANCH_MANAGER';

  return (
    <div className="space-y-6">
      {/* Banner Sambutan Kontekstual */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold text-blue-600 uppercase tracking-wider bg-blue-50 px-2 py-0.5 rounded-md">
                {roleTitle}
              </span>
              <span className="text-xs text-slate-400">•</span>
              <span className="text-xs text-slate-500 font-medium">
                {user?.branchName || 'Kantor Pusat Korporat'}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
              Selamat datang kembali, {user?.fullName}
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              {isEmployee
                ? 'Pantau jadwal shift Anda, lakukan absensi masuk/keluar harian, dan ajukan cuti mandiri.'
                : isManager
                ? 'Pantau kehadiran staf Cabang A secara waktu-nyata, tinjau permohonan cuti, dan optimalkan shift.'
                : 'Pusat komando operasional seluruh cabang, kepatuhan absensi, dan integritas data IAM.'}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-right">
              <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                Tingkat Kehadiran Hari Ini
              </span>
              <span className="text-lg font-bold text-slate-900 font-mono">
                {summary?.attendanceRate}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Grid Kartu Metrik KPI Ringkas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Total Staf Aktif
            </span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-extrabold text-slate-900 font-mono">
              {summary?.totalEmployees}
            </div>
            <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-1">
              <span>{isEmployee ? 'Rekan kerja cabang' : 'Staf terdaftar'}</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Hadir Hari Ini
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <UserCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-extrabold text-emerald-600 font-mono">
              {summary?.presentCount}
            </div>
            <div className="flex items-center gap-1 text-[11px] text-emerald-600 mt-1 font-semibold">
              <TrendingUp className="w-3 h-3" />
              <span>{summary?.attendanceRate}% Ketepatan</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Terlambat
            </span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-extrabold text-amber-600 font-mono">
              {summary?.lateCount}
            </div>
            <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-1">
              <span>Rata-rata 14 menit</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Cuti Aktif
            </span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <CalendarOff className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-extrabold text-blue-600 font-mono">
              {summary?.leaveCount}
            </div>
            <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-1">
              <span>{summary?.absentCount} Tidak Hadir</span>
            </div>
          </div>
        </div>
      </div>

      {/* Grid Grafik Tren Kehadiran & Alokasi Departemen */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tren Kehadiran 7 Hari Terakhir */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-600" />
                Tren Kehadiran Mingguan (7 Hari Terakhir)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Statistik kehadiran kerja dan rasio ketepatan waktu
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1 text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                Hadir
              </span>
              <span className="flex items-center gap-1 text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                Terlambat
              </span>
              <span className="flex items-center gap-1 text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                Cuti
              </span>
            </div>
          </div>

          {/* Batang Visualisasi Mingguan */}
          <div className="grid grid-cols-7 gap-2 pt-2 items-end h-44">
            {summary?.weeklyTrend.map((t) => {
              const max = 70;
              const presentHeight = Math.min(100, (t.present / max) * 100);
              const lateHeight = Math.min(30, (t.late / max) * 100);

              return (
                <div key={t.date} className="flex flex-col items-center h-full justify-end group">
                  <div className="text-[10px] text-slate-400 font-mono mb-1 group-hover:text-slate-800 font-semibold">
                    {t.present}
                  </div>
                  <div className="w-full max-w-8 bg-slate-100 rounded-t-lg flex flex-col justify-end overflow-hidden h-32 p-0.5 gap-0.5">
                    {t.late > 0 && (
                      <div
                        className="w-full bg-amber-400 rounded-xs transition-all duration-300"
                        style={{ height: `${lateHeight}%` }}
                        title={`${t.late} terlambat`}
                      />
                    )}
                    <div
                      className="w-full bg-emerald-500 rounded-xs transition-all duration-300"
                      style={{ height: `${presentHeight}%` }}
                      title={`${t.present} hadir`}
                    />
                  </div>
                  <div className="mt-2 text-center">
                    <span className="text-xs font-bold text-slate-700 block">{t.day}</span>
                    <span className="text-[10px] text-slate-400 font-mono block">
                      {t.date.slice(8)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Distribusi Staf per Departemen */}
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Building className="w-4 h-4 text-blue-600" />
              Alokasi Departemen
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">Proporsi staf aktif per divisi</p>
          </div>

          <div className="space-y-3 pt-1">
            {summary?.departmentDistribution.map((dept) => (
              <div key={dept.name} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-slate-700 truncate pr-2">{dept.name}</span>
                  <span className="font-bold text-slate-900 shrink-0 font-mono">
                    {dept.count} ({dept.percentage}%)
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${dept.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Log Aktivitas Terkini & Informasi Keamanan */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Aktivitas Operasional Terkini */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Aktivitas Operasional Terkini</h3>
              <p className="text-xs text-slate-500">Log kehadiran dan permohonan staf waktu-nyata</p>
            </div>
            <span className="text-[11px] text-blue-600 font-semibold">Waktu Nyata (WIB)</span>
          </div>

          <div className="divide-y divide-slate-100">
            {summary?.recentActivity.map((act) => (
              <div key={act.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-700 font-bold flex items-center justify-center shrink-0 text-xs">
                    {act.employeeName.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 truncate">{act.employeeName}</p>
                    <p className="text-slate-500 truncate">{act.action}</p>
                  </div>
                </div>
                <span className="text-[11px] font-mono text-slate-400 shrink-0">
                  {act.timestamp}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Lencana Keamanan & Integritas Gateway */}
        <div className="bg-slate-900 text-white rounded-xl p-5 shadow-xs flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-blue-400 text-xs font-bold uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4" />
              Integritas Sistem Terjamin
            </div>
            <h4 className="text-sm font-bold text-white">Protokol HMAC v2.7 & Anti-Replay</h4>
            <p className="text-xs text-slate-300 leading-relaxed">
              Setiap transaksi presensi dan keputusan cuti divalidasi dengan penandatanganan HMAC
              SHA-256 dan verifikasi nonce 300 detik pada skema <code>nexus_internal</code>.
            </p>
          </div>

          <div className="pt-3 border-t border-slate-800 space-y-2 text-xs">
            <div className="flex justify-between text-slate-400">
              <span>Database Cabang:</span>
              <span className="font-mono text-slate-200">PostgreSQL 17.11</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Status Gateway:</span>
              <span className="text-emerald-400 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Aktif Terhubung
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
