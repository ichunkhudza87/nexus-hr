import React, { useState } from 'react';
import { Menu, Bell, ShieldCheck, CheckCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getRoleLabel } from '../utils/formatters';
import { isLiveApiMode } from '../services/api';
import type { NavItemKey } from './Sidebar';

interface TopbarProps {
  currentTab: NavItemKey;
  onOpenMobileSidebar: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({ currentTab, onOpenMobileSidebar }) => {
  const { user } = useAuth();
  const [showNotifications, setShowNotifications] = useState(false);

  const titleMap: Record<NavItemKey, { title: string; subtitle: string }> = {
    overview: {
      title: 'Ringkasan Eksekutif & Dasbor',
      subtitle: 'Ikhtisar metrik kehadiran, staf aktif, dan efisiensi operasional',
    },
    employees: {
      title: 'Direktori & Data Karyawan',
      subtitle: 'Kelola basis data staf, status hubungan kerja, dan penugasan departemen',
    },
    departments: {
      title: 'Departemen & Struktur Jabatan',
      subtitle: 'Hierarki organisasi, divisi fungsional, dan standar posisi',
    },
    shifts: {
      title: 'Konfigurasi Shift Kerja',
      subtitle: 'Manajemen jam kerja operasional, batas istirahat, dan rotasi shift',
    },
    schedules: {
      title: 'Jadwal & Roster Kerja',
      subtitle: 'Roster mingguan, alokasi shift staf, dan cakupan tugas harian',
    },
    attendance: {
      title: 'Pencatatan Kehadiran & Log Absensi',
      subtitle: 'Log kehadiran waktu-nyata, verifikasi biometrik, dan audit ketepatan waktu',
    },
    leaves: {
      title: 'Pengajuan & Persetujuan Cuti',
      subtitle: 'Permohonan cuti karyawan, verifikasi berkas, dan persetujuan manajerial',
    },
    reports: {
      title: 'Laporan Analitik & Kepatuhan SDM',
      subtitle: 'Rekapitulasi kepatuhan kehadiran, tren absensi, dan ekspor data',
    },
    users: {
      title: 'Manajemen Pengguna & Akses IAM',
      subtitle: 'Kelola kredensial akun, kewenangan peran, dan status otorisasi',
    },
    settings: {
      title: 'Pengaturan Sistem & Telemetri Node',
      subtitle: 'Konfigurasi node database terdistribusi, profil akun, dan parameter keamanan',
    },
  };

  const currentInfo = titleMap[currentTab] ?? {
    title: 'NEXUS HR Enterprise',
    subtitle: 'Sistem Manajemen SDM Terdistribusi',
  };

  const notifications = [
    {
      id: '1',
      title: 'Pengajuan Cuti Baru',
      desc: 'Budi Santoso mengajukan cuti tahunan (3 hari)',
      time: '10 menit lalu',
      unread: true,
    },
    {
      id: '2',
      title: 'Pengingat Jadwal Shift',
      desc: 'Shift Malam Infrastruktur dimulai pukul 22:00 WIB',
      time: '1 jam lalu',
      unread: false,
    },
    {
      id: '3',
      title: 'Pemberitahuan Keterlambatan',
      desc: 'Fajar Nugraha tercatat terlambat (+25 menit)',
      time: '3 jam lalu',
      unread: false,
    },
  ];

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between sticky top-0 z-30 shrink-0">
      {/* Bagian Kiri: Tombol Menu Mobile & Judul Halaman */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileSidebar}
          className="lg:hidden p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg shrink-0 transition-colors"
          aria-label="Buka menu navigasi"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight truncate">
              {currentInfo.title}
            </h1>
          </div>
          <p className="text-[11px] text-slate-500 hidden sm:block truncate">
            {currentInfo.subtitle}
          </p>
        </div>
      </div>

      {/* Bagian Kanan: Status Node & Aksi Cepat */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Lencana Identitas Node Database Terdistribusi */}
        <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[11px] font-semibold text-slate-700">
            {user?.role === 'SUPERADMIN' ? 'Node Pusat' : 'Node Cabang A'}
          </span>
          <span className="text-[10px] text-slate-400 font-mono hidden xl:inline">
            ({user?.branchId ? 'uneycmbqqpkifwhwzbes' : 'wcmevigbqsmzsdqidjel'})
          </span>
        </div>

        {/* Lencana Mode Operasional (Live / Mock) */}
        <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs">
          <span
            className={`w-2 h-2 rounded-full ${
              isLiveApiMode() ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
            }`}
          />
          <span className="text-[11px] font-semibold text-slate-700">
            {isLiveApiMode() ? 'Live Gateway API' : 'Simulasi Offline (Mock)'}
          </span>
        </div>

        {/* Lencana Verifikasi Kriptografi Gateway */}
        <div className="hidden sm:flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>HMAC v2.7</span>
        </div>

        {/* Dropdown Notifikasi */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowNotifications(!showNotifications)}
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg relative transition-colors"
            aria-label="Pemberitahuan sistem"
          >
            <Bell className="w-4 h-4" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-600 rounded-full ring-2 ring-white" />
          </button>

          {showNotifications && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowNotifications(false)}
              />
              <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">Pemberitahuan Sistem</span>
                  <span className="text-[10px] bg-blue-50 text-blue-700 font-semibold px-2 py-0.5 rounded-full">
                    1 Baru
                  </span>
                </div>
                <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`p-3 text-xs hover:bg-slate-50 transition-colors ${
                        n.unread ? 'bg-blue-50/40' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between font-semibold text-slate-800 mb-0.5">
                        <span className="truncate">{n.title}</span>
                        <span className="text-[10px] font-normal text-slate-400 shrink-0 ml-2">
                          {n.time}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed">{n.desc}</p>
                    </div>
                  ))}
                </div>
                <div className="p-2 border-t border-slate-100 text-center">
                  <button
                    type="button"
                    onClick={() => setShowNotifications(false)}
                    className="text-[11px] text-blue-600 font-semibold hover:underline inline-flex items-center gap-1"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    Tandai semua telah dibaca
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Avatar Ringkas Pengguna */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
          <div className="w-8 h-8 rounded-lg bg-blue-600 text-white font-bold flex items-center justify-center text-xs shadow-xs">
            {user?.fullName.charAt(0) ?? 'U'}
          </div>
          <div className="hidden xl:block text-left">
            <p className="text-xs font-bold text-slate-900 leading-none truncate max-w-28">
              {user?.fullName}
            </p>
            <p className="text-[10px] text-slate-500 font-medium mt-0.5">
              {getRoleLabel(user?.role)}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
};
