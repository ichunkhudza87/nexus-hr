import React, { useState } from 'react';
import {
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  Printer,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { MOCK_DASHBOARD_SUMMARY } from '../services/mock-data';
import { formatDate } from '../utils/formatters';

export const ReportsPage: React.FC = () => {
  const { showToast } = useToast();
  const [selectedMonth, setSelectedMonth] = useState('2026-11');

  const summary = MOCK_DASHBOARD_SUMMARY;

  const handleExportFullCSV = () => {
    const csvRows = [
      ['LAPORAN EKSEKUTIF SUMBER DAYA MANUSIA — NEXUS HR ENTERPRISE'],
      ['Periode Pelaporan', selectedMonth],
      ['Tanggal Dibuat', new Date().toISOString()],
      ['Jurisdiksi Node', 'Cabang A Jakarta (uneycmbqqpkifwhwzbes) & Kantor Pusat'],
      [],
      ['INDIKATOR KINERJA UTAMA (KPI)', 'NILAI METRIK', 'STATUS EVALUASI'],
      ['Total Karyawan Aktif', summary.totalEmployees, 'STABIL'],
      ['Kehadiran Rata-rata', `${summary.attendanceRate}%`, 'OPTIMAL (Memenuhi SLA >90%)'],
      ['Insiden Keterlambatan', `${summary.lateCount} Staf`, 'DALAM BATAS WAJAR'],
      ['Cuti Terencana', `${summary.leaveCount} Staf`, 'TERJADWAL'],
      ['Ketidakhadiran Tanpa Keterangan', `${summary.absentCount} Staf`, 'PERLU TINJAUAN'],
      [],
      ['DISTRIBUSI DIVISI KERJA', 'JUMLAH STAF', 'PERSENTASE'],
      ...summary.departmentDistribution.map((d) => [d.name, d.count, `${d.percentage}%`]),
      [],
      ['TREN KEHADIRAN 7 HARI TERAKHIR', 'TANGGAL', 'HADIR', 'TERLAMBAT', 'ABSEN', 'CUTI'],
      ...summary.weeklyTrend.map((t) => [t.day, t.date, t.present, t.late, t.absent, t.leave]),
    ];

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      csvRows.map((e) => e.map((val) => `"${val}"`).join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `laporan_sdm_nexus_${selectedMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('success', `Laporan eksekutif periode ${selectedMonth} berhasil diunduh.`);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Header Halaman & Aksi Ekspor */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Laporan Analitik & Kepatuhan SDM
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Agregasi intelijen tenaga kerja, tren presensi operasional, dan rekapitulasi audit kepatuhan.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            aria-label="Pilih Periode Bulan Laporan"
            className="px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 bg-white text-slate-700 shadow-xs focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={handleExportFullCSV}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 shadow-xs transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4 text-slate-500" />
            Ekspor CSV
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-xs transition-colors cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            Cetak Laporan
          </button>
        </div>
      </div>

      {/* Header Saat Dicetak (Hanya Muncul Saat Print) */}
      <div className="hidden print:block pb-4 mb-4 border-b border-black">
        <h1 className="text-xl font-bold text-black">NEXUS HR — LAPORAN EKSEKUTIF SDM</h1>
        <p className="text-xs text-gray-700">Periode: {selectedMonth} • Dicetak pada: {new Date().toLocaleDateString('id-ID')}</p>
      </div>

      {/* Grid Kartu Metrik KPI Eksekutif */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-slate-500">
              Total Tenaga Kerja
            </span>
            <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 font-mono">
              {summary.totalEmployees}
            </span>
            <span className="text-xs text-emerald-600 font-semibold">+2 bulan ini</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Staf tetap & tenaga kontrak</p>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-slate-500">
              Tingkat Kehadiran
            </span>
            <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 font-mono">
              {summary.attendanceRate}%
            </span>
            <span className="text-xs text-emerald-600 font-semibold">Memenuhi SLA</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Standar kepatuhan cabang &gt;90%</p>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-slate-500">
              Skor Ketepatan
            </span>
            <div className="p-2 bg-amber-50 rounded-lg text-amber-600">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 font-mono">96.8%</span>
            <span className="text-xs text-amber-600 font-semibold">{summary.lateCount} keterlambatan</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Rata-rata deviasi: 14 menit</p>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-slate-500">
              Penggunaan Cuti
            </span>
            <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
              <Calendar className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 font-mono">
              {summary.leaveCount}
            </span>
            <span className="text-xs text-blue-600 font-semibold">Cuti Resmi</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Cakupan tugas pengganti terpenuhi</p>
        </div>
      </div>

      {/* Grid Rincian Analitik */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Alokasi Staf per Divisi */}
        <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-xs space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-600" />
              Alokasi Divisi & Kepatuhan Organisasi
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">Sebaran karyawan aktif per unit kerja</p>
          </div>
          <div className="space-y-3.5">
            {summary.departmentDistribution.map((dept) => (
              <div key={dept.name} className="space-y-1.5">
                <div className="flex justify-between text-xs font-semibold text-slate-700">
                  <span>{dept.name}</span>
                  <span className="font-mono">
                    {dept.count} staf ({dept.percentage}%)
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

        {/* Tabel Log Operasional Mingguan */}
        <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-xs space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-600" />
              Log Rekapitulasi Presensi (7 Hari Terakhir)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">Rincian harian status kehadiran operasional</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 uppercase font-semibold">
                  <th className="py-2.5">Tanggal</th>
                  <th className="py-2.5">Hari</th>
                  <th className="py-2.5 text-center">Hadir</th>
                  <th className="py-2.5 text-center">Terlambat</th>
                  <th className="py-2.5 text-center">Absen</th>
                  <th className="py-2.5 text-center">Cuti</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {summary.weeklyTrend.map((t) => (
                  <tr key={t.date} className="hover:bg-slate-50">
                    <td className="py-2.5 font-mono text-slate-600">{formatDate(t.date)}</td>
                    <td className="py-2.5 font-bold text-slate-900">{t.day}</td>
                    <td className="py-2.5 text-center text-emerald-700 font-bold font-mono">
                      {t.present}
                    </td>
                    <td className="py-2.5 text-center text-amber-600 font-bold font-mono">
                      {t.late}
                    </td>
                    <td className="py-2.5 text-center text-rose-600 font-bold font-mono">
                      {t.absent}
                    </td>
                    <td className="py-2.5 text-center text-blue-600 font-bold font-mono">
                      {t.leave}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Pernyataan Audit Integritas Kepatuhan */}
      <div className="bg-blue-50/60 border border-blue-200 p-4 rounded-xl flex items-start gap-3">
        <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <div className="text-xs text-slate-700 leading-relaxed">
          <strong className="text-slate-900 block font-bold mb-0.5">
            Pernyataan Kepatuhan & Integritas Kriptografis
          </strong>
          Seluruh log presensi dan rekam jejak keputusan cuti yang terangkum dalam laporan ini disinkronkan melalui NEXUS HR Gateway dengan validasi nonces aktor berdasarkan aturan keamanan PostgreSQL v2.7.1. Log audit bersifat tahan-manipulasi dan diawetkan untuk memenuhi kepatuhan regulasi ketenagakerjaan lintas cabang.
        </div>
      </div>
    </div>
  );
};
