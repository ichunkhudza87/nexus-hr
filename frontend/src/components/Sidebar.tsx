import React, { useEffect } from 'react';
import {
  Users,
  Building2,
  Clock,
  CalendarDays,
  UserCheck,
  CalendarOff,
  BarChart3,
  Shield,
  Settings,
  LayoutDashboard,
  LogOut,
  ChevronRight,
  X,
  Layers,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getRoleLabel } from '../utils/formatters';
import type { UserRole } from '../types';

export type NavItemKey =
  | 'overview'
  | 'employees'
  | 'departments'
  | 'shifts'
  | 'schedules'
  | 'attendance'
  | 'leaves'
  | 'reports'
  | 'users'
  | 'settings';

interface SidebarProps {
  currentTab: NavItemKey;
  onSelectTab: (tab: NavItemKey) => void;
  isOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  isOpen,
  onCloseMobile,
}) => {
  const { user, switchRole, logout } = useAuth();

  // Kunci scroll halaman belakang saat drawer mobile terbuka
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const navItems: Array<{
    key: NavItemKey;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    roles?: UserRole[];
    badge?: string;
  }> = [
    { key: 'overview', label: 'Ringkasan', icon: LayoutDashboard },
    { key: 'employees', label: 'Data Karyawan', icon: Users },
    {
      key: 'departments',
      label: 'Departemen & Jabatan',
      icon: Building2,
      roles: ['SUPERADMIN', 'BRANCH_MANAGER', 'CENTRAL_HR', 'BRANCH_HR'],
    },
    {
      key: 'shifts',
      label: 'Shift Kerja',
      icon: Clock,
      roles: ['SUPERADMIN', 'BRANCH_MANAGER', 'BRANCH_HR'],
    },
    { key: 'schedules', label: 'Jadwal Kerja', icon: CalendarDays },
    { key: 'attendance', label: 'Kehadiran', icon: UserCheck },
    { key: 'leaves', label: 'Pengajuan Cuti', icon: CalendarOff },
    {
      key: 'reports',
      label: 'Laporan Eksekutif',
      icon: BarChart3,
      roles: ['SUPERADMIN', 'BRANCH_MANAGER', 'CENTRAL_HR', 'BRANCH_HR'],
    },
    {
      key: 'users',
      label: 'Manajemen Pengguna',
      icon: Shield,
      roles: ['SUPERADMIN'],
    },
    { key: 'settings', label: 'Pengaturan Sistem', icon: Settings },
  ];

  const visibleItems = navItems.filter((item) => {
    if (!item.roles) return true;
    return user ? item.roles.includes(user.role) : false;
  });

  return (
    <>
      {/* Mobile Drawer Backdrop */}
      {isOpen && (
        <div
          onClick={onCloseMobile}
          aria-hidden="true"
          className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-40 lg:hidden transition-opacity"
        />
      )}

      {/* Sidebar Container */}
      <aside
        aria-label="Navigasi Utama"
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800 transition-transform duration-300 ease-in-out lg:static lg:w-64 lg:shrink-0 lg:h-screen lg:sticky lg:top-0 ${
          isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Header Branding */}
        <div className="h-16 flex items-center justify-between px-5 border-b border-slate-800/80 bg-slate-950/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center font-extrabold text-white shadow-md shadow-blue-500/20 text-sm tracking-wide">
              N
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-white tracking-tight text-base">NEXUS HR</span>
                <span className="text-[10px] bg-blue-500/20 text-blue-400 font-mono px-1.5 py-0.5 rounded font-semibold">
                  v2.7
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-medium">Sistem SDM Terdistribusi</p>
            </div>
          </div>

          <button
            onClick={onCloseMobile}
            className="lg:hidden p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
            aria-label="Tutup menu navigasi"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Pemilih Peran Demo (Simulasi Cepat) */}
        <div className="p-3 mx-3 my-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60 shrink-0">
          <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold mb-1.5 uppercase tracking-wider">
            <span className="flex items-center gap-1 text-slate-300">
              <Layers className="w-3 h-3 text-blue-400" />
              Simulasi Peran
            </span>
            <span className="text-blue-400 font-mono">{user?.role}</span>
          </div>
          <select
            value={user?.role ?? 'SUPERADMIN'}
            onChange={(e) => switchRole(e.target.value as UserRole)}
            aria-label="Ganti peran pengguna simulasi"
            className="w-full bg-slate-950 border border-slate-700 text-slate-100 text-xs rounded-lg px-2.5 py-1.5 font-medium focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer transition-colors"
          >
            <option value="SUPERADMIN">Superadmin (Pusat / Global)</option>
            <option value="BRANCH_MANAGER">Manajer Cabang (Cabang A)</option>
            <option value="EMPLOYEE">Karyawan (Akses Mandiri)</option>
          </select>
        </div>

        {/* Daftar Navigasi Utama (Independent Scrollable Area) */}
        <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto dark-scrollbar min-h-0">
          <div className="px-3 py-1.5 text-[10px] font-semibold tracking-wider uppercase text-slate-400">
            Menu Utama
          </div>

          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  onSelectTab(item.key);
                  onCloseMobile();
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30 font-bold'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 transition-colors ${
                      isActive ? 'text-white' : 'text-slate-400'
                    }`}
                  />
                  <span className="truncate">{item.label}</span>
                </div>
                {isActive ? (
                  <ChevronRight className="w-3.5 h-3.5 text-white/80 shrink-0" />
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* Footer Profil Pengguna */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-950/60 shrink-0">
          <div className="flex items-center justify-between px-2 py-1.5 gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 text-white font-bold flex items-center justify-center text-xs shrink-0">
                {user?.fullName.charAt(0) ?? 'U'}
              </div>
              <div className="min-w-0 truncate">
                <p className="text-xs font-bold text-white truncate">{user?.fullName}</p>
                <p className="text-[11px] text-blue-400 font-medium truncate">
                  {getRoleLabel(user?.role)}
                </p>
                <p className="text-[10px] text-slate-400 truncate">{user?.branchName}</p>
              </div>
            </div>

            <button
              onClick={logout}
              title="Keluar dari sesi"
              aria-label="Keluar dari sesi"
              className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition-colors shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
