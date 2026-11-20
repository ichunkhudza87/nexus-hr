import React, { useState } from 'react';
import {
  ShieldCheck,
  Lock,
  Mail,
  Eye,
  EyeOff,
  UserCheck,
  Building2,
  Server,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { isLiveApiMode } from '../services/api';

export const LoginPage: React.FC = () => {
  const { login, loginWithCredentials } = useAuth();
  const { showToast } = useToast();

  const [email, setEmail] = useState('admin@nexus.local');
  const [password, setPassword] = useState('password123');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      showToast('error', 'Silakan masukkan alamat email dan kata sandi.');
      return;
    }

    setLoading(true);
    try {
      if (isLiveApiMode()) {
        try {
          await loginWithCredentials(email, password);
          showToast('success', 'Autentikasi Central Supabase Auth berhasil.');
        } catch (authErr: any) {
          console.warn('[LoginPage] Central Supabase Auth attempt failed:', authErr);
          showToast('error', `Central Auth: ${authErr.message || 'Kredensial tidak valid atau akun belum terdaftar'}.`);
        }
      } else {
        if (email.includes('admin')) {
          await login('superadmin');
        } else if (email.includes('manager')) {
          await login('manager');
        } else {
          await login('employee');
        }
        showToast('success', 'Autentikasi berhasil. Selamat datang di NEXUS HR.');
      }
    } catch {
      showToast('error', 'Gagal masuk. Periksa kembali kredensial Anda.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = async (roleKey: 'superadmin' | 'manager' | 'employee') => {
    setLoading(true);
    try {
      await login(roleKey);
      showToast('success', 'Sesi demo berhasil diaktifkan.');
    } catch {
      showToast('error', 'Gagal memuat akun demonstrasi.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Latar Belakang Dekoratif Halus */}
      <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-40 pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        {/* Identitas Logo & Brand */}
        <div className="flex justify-center">
          <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center font-extrabold text-white text-2xl shadow-xl shadow-blue-500/20 border border-blue-400/30">
            N
          </div>
        </div>
        <h2 className="mt-5 text-center text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
          NEXUS HR Enterprise
        </h2>
        <p className="mt-1 text-center text-xs sm:text-sm text-slate-400">
          Sistem Manajemen SDM & Kehadiran Terdistribusi
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl shadow-2xl p-6 sm:p-8 backdrop-blur-md">
          {/* Formulir Masuk */}
          <form className="space-y-5" onSubmit={handleLogin}>
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-semibold text-slate-300 uppercase tracking-wider"
              >
                Alamat Email Korporat
              </label>
              <div className="mt-1.5 relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nama@nexus.local"
                  className="block w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-700 bg-slate-900/80 text-white placeholder-slate-500 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-semibold text-slate-300 uppercase tracking-wider"
              >
                Kata Sandi
              </label>
              <div className="mt-1.5 relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="block w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-700 bg-slate-900/80 text-white placeholder-slate-500 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-200"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center items-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 shadow-md shadow-blue-600/30 transition-all focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Memverifikasi...' : 'Masuk ke Sistem'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Pemisah Mode Demonstrasi */}
          <div className="mt-6 pt-6 border-t border-slate-700/80">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-blue-400" />
                Akses Demo Cepat
              </span>
              <span className="text-[10px] bg-slate-700/80 text-slate-300 px-2 py-0.5 rounded-full font-medium">
                Simulasi Evaluasi
              </span>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => handleQuickLogin('superadmin')}
                className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-900/60 hover:bg-slate-900 border border-slate-700/60 hover:border-blue-500/50 text-left transition-all group cursor-pointer"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-200 group-hover:text-blue-400 transition-colors">
                      Alexander Wright
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">
                      Superadmin Pusat • Akses Korporat & IAM
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-mono bg-purple-900/40 text-purple-300 px-2 py-0.5 rounded shrink-0">
                  PUSAT
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin('manager')}
                className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-900/60 hover:bg-slate-900 border border-slate-700/60 hover:border-blue-500/50 text-left transition-all group cursor-pointer"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
                    <UserCheck className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-200 group-hover:text-blue-400 transition-colors">
                      Dewi Lestari
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">
                      Manajer Cabang • Persetujuan Cuti Cabang A
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-mono bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded shrink-0">
                  CABANG A
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin('employee')}
                className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-900/60 hover:bg-slate-900 border border-slate-700/60 hover:border-blue-500/50 text-left transition-all group cursor-pointer"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                    <UserCheck className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-200 group-hover:text-blue-400 transition-colors">
                      Budi Santoso
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">
                      Karyawan • Absensi Mandiri & Roster
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-mono bg-emerald-900/40 text-emerald-300 px-2 py-0.5 rounded shrink-0">
                  STAF
                </span>
              </button>
            </div>
          </div>

          {/* Catatan Kepatuhan Keamanan */}
          <div className="mt-5 pt-4 border-t border-slate-700/50 flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              Protokol Keamanan HMAC v2.7
            </span>
            <span className="font-mono text-slate-400">PostgreSQL 17.11</span>
          </div>
        </div>
      </div>
    </div>
  );
};
