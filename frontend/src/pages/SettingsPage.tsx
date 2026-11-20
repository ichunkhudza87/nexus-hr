import React, { useState } from 'react';
import {
  CheckCircle2,
  Database,
  Key,
  RefreshCw,
  Server,
  User,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getRoleLabel } from '../utils/formatters';

export const SettingsPage: React.FC = () => {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [passwordState, setPasswordState] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const handleUpdatePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordState.currentPassword || !passwordState.newPassword) {
      showToast('error', 'Silakan masukkan kata sandi saat ini dan kata sandi baru.');
      return;
    }
    if (passwordState.newPassword !== passwordState.confirmPassword) {
      showToast('error', 'Konfirmasi kata sandi baru tidak cocok.');
      return;
    }
    showToast('success', 'Kredensial keamanan berhasil diperbarui.');
    setPasswordState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  };

  const handleResetDemoData = () => {
    localStorage.removeItem('nexus_demo_user');
    showToast('info', 'Sesi demo berhasil diatur ulang. Memuat ulang aplikasi...');
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header Halaman */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          Pengaturan Sistem & Telemetri Node
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
          Status klaster database terdistribusi, parameter kriptografi HMAC, dan profil identitas akun.
        </p>
      </div>

      {/* Kartu Telemetri Arsitektur Node Terdistribusi */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Topologi Node Database Terdistribusi
              </h2>
              <p className="text-xs text-slate-500">
                Status konektivitas skema dan replikasi data multi-cabang
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Seluruh Node Normal
          </span>
        </div>

        {/* Grid Status Database */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/80 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-blue-600" />
                Database Pusat (Central DB)
              </span>
              <span className="font-mono text-emerald-600 font-bold">PostgreSQL 17.11</span>
            </div>
            <div className="font-mono text-xs font-bold text-slate-800">
              wcmevigbqsmzsdqidjel (nexus-central)
            </div>
            <div className="text-[11px] text-slate-500 leading-relaxed">
              Fungsi: Registri Cabang Global, Manajemen Pengguna IAM & Katalog Otoritas
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/80 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-blue-600" />
                Database Cabang (Branch Node DB)
              </span>
              <span className="font-mono text-emerald-600 font-bold">PostgreSQL 17.11</span>
            </div>
            <div className="font-mono text-xs font-bold text-slate-800">
              uneycmbqqpkifwhwzbes (nexus-branch-a)
            </div>
            <div className="text-[11px] text-slate-500 leading-relaxed">
              Remediasi: v2.7.1 Pengerasan Keamanan + v2.7.2 Kompatibilitas Skema
            </div>
          </div>
        </div>

        {/* Rincian Parameter Keamanan Gateway */}
        <div className="p-4 rounded-xl bg-blue-50/50 border border-blue-100 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <span className="text-slate-500 block mb-0.5 font-medium">Protokol Penandatanganan:</span>
            <span className="font-mono font-bold text-slate-900">HMAC-SHA256 v2.7</span>
          </div>
          <div>
            <span className="text-slate-500 block mb-0.5 font-medium">Proteksi Replay:</span>
            <span className="font-mono font-bold text-slate-900">Jendela Nonce 300 Detik</span>
          </div>
          <div>
            <span className="text-slate-500 block mb-0.5 font-medium">Propagasi Konteks:</span>
            <span className="font-mono font-bold text-slate-900">nexus_internal.tx_actor_context</span>
          </div>
        </div>
      </div>

      {/* Kartu Profil Identitas Pengguna */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100">
          <div className="p-2 bg-slate-100 text-slate-700 rounded-xl">
            <User className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Profil Identitas Akun Sesi</h2>
            <p className="text-xs text-slate-500">Keterangan akun yang sedang aktif digunakan</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
              Nama Lengkap
            </label>
            <input
              type="text"
              disabled
              value={user?.fullName || ''}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-800 font-semibold"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
              Alamat Email Terdaftar
            </label>
            <input
              type="email"
              disabled
              value={user?.email || ''}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-800 font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
              Peran Sistem Terotorisasi
            </label>
            <input
              type="text"
              disabled
              value={getRoleLabel(user?.role)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm text-blue-700 font-bold"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
              Yurisdiksi Penugasan Cabang
            </label>
            <input
              type="text"
              disabled
              value={user?.branchName || 'Kantor Pusat Korporat'}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-800 font-medium"
            />
          </div>
        </div>
      </div>

      {/* Kartu Pembaruan Kredensial Keamanan */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100">
          <div className="p-2 bg-slate-100 text-slate-700 rounded-xl">
            <Key className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Kredensial Keamanan Akun</h2>
            <p className="text-xs text-slate-500">Pembaruan kata sandi autentikasi</p>
          </div>
        </div>

        <form onSubmit={handleUpdatePassword} className="space-y-4 max-w-md">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
              Kata Sandi Saat Ini
            </label>
            <input
              type="password"
              placeholder="••••••••"
              value={passwordState.currentPassword}
              onChange={(e) =>
                setPasswordState({ ...passwordState, currentPassword: e.target.value })
              }
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
              Kata Sandi Baru
            </label>
            <input
              type="password"
              placeholder="••••••••"
              value={passwordState.newPassword}
              onChange={(e) =>
                setPasswordState({ ...passwordState, newPassword: e.target.value })
              }
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
              Konfirmasi Kata Sandi Baru
            </label>
            <input
              type="password"
              placeholder="••••••••"
              value={passwordState.confirmPassword}
              onChange={(e) =>
                setPasswordState({ ...passwordState, confirmPassword: e.target.value })
              }
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-slate-800 hover:bg-slate-900 shadow-sm transition-colors cursor-pointer"
          >
            Simpan Kata Sandi
          </button>
        </form>
      </div>

      {/* Kartu Pengaturan Ulang Sesi Demonstrasi */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Atur Ulang Sesi Demonstrasi Lokal</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Menghapus cache sesi peramban dan mengembalikan seluruh data simulasi ke kondisi awal.
          </p>
        </div>
        <button
          type="button"
          onClick={handleResetDemoData}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors cursor-pointer shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Atur Ulang Data Demo
        </button>
      </div>
    </div>
  );
};
