import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Lock,
  ShieldAlert,
  UserPlus,
  UserX,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../services/api';
import { getRoleLabel } from '../utils/formatters';
import type { UserAccount, UserRole } from '../types';

export const UserManagementPage: React.FC = () => {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [users, setUsers] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    role: 'EMPLOYEE' as UserRole,
    branchName: 'Cabang A - Jakarta',
  });

  const isSuperadmin = user?.role === 'SUPERADMIN';

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await api.getUsers();
      setUsers(data);
    } catch {
      showToast('error', 'Gagal memuat direktori kredensial pengguna.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isSuperadmin) {
      loadUsers();
    }
  }, [isSuperadmin]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fullName || !form.email) {
      showToast('error', 'Silakan isi seluruh kolom wajib pengguna.');
      return;
    }
    setSubmitting(true);
    try {
      await api.createUserAccount({
        fullName: form.fullName,
        email: form.email,
        role: form.role,
        branchName: form.branchName || null,
        isActive: true,
      });
      showToast('success', `Akun kredensial untuk ${form.fullName} berhasil dibuat.`);
      setShowModal(false);
      setForm({
        fullName: '',
        email: '',
        role: 'EMPLOYEE',
        branchName: 'Cabang A - Jakarta',
      });
      await loadUsers();
    } catch {
      showToast('error', 'Gagal membuat akun pengguna.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (targetUser: UserAccount) => {
    if (targetUser.id === user?.id) {
      showToast('error', 'Tidak diperbolehkan menangguhkan akun administrator aktif Anda sendiri.');
      return;
    }
    try {
      const updated = await api.toggleUserStatus(targetUser.id);
      const statusText = updated.isActive ? 'Diaktifkan' : 'Ditangguhkan';
      showToast('info', `Status akun ${targetUser.fullName} sekarang ${statusText}.`);
      await loadUsers();
    } catch {
      showToast('error', 'Gagal mengubah status akun pengguna.');
    }
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'SUPERADMIN':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'BRANCH_MANAGER':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'CENTRAL_HR':
        return 'bg-teal-100 text-teal-800 border-teal-200';
      case 'BRANCH_HR':
        return 'bg-cyan-100 text-cyan-800 border-cyan-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  if (!isSuperadmin) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 sm:p-12 text-center max-w-xl mx-auto mt-8 shadow-xs">
        <div className="w-16 h-16 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-4 border border-rose-100">
          <Lock className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">Akses Terbatas: Manajemen Pengguna</h2>
        <p className="text-xs sm:text-sm text-slate-500 mt-2 leading-relaxed">
          Direktori pengguna dan eskalasi hak istimewa IAM hanya dapat dikelola secara eksklusif oleh peran{' '}
          <strong className="text-slate-800 font-bold">Superadmin Pusat</strong> sesuai kebijakan tata kelola keamanan sistem.
        </p>
        <p className="text-xs text-slate-400 mt-4">
          Peran sesi aktif Anda:{' '}
          <span className="font-mono font-bold text-slate-700">{getRoleLabel(user?.role)}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Halaman */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Manajemen Pengguna & Akses IAM
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Kelola kredensial pengguna terautentikasi, alokasi node cabang, dan eskalasi hak istimewa peran.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors cursor-pointer shrink-0"
        >
          <UserPlus className="w-4 h-4" />
          Tambah Pengguna Baru
        </button>
      </div>

      {/* Banner Kebijakan Audit Keamanan */}
      <div className="p-4 bg-purple-50/70 border border-purple-200 rounded-xl flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-purple-700 shrink-0 mt-0.5" />
        <div className="text-xs text-purple-900 leading-relaxed">
          <strong className="block font-bold">Kebijakan Audit Keamanan PostgreSQL v2.7.1</strong>
          Setiap pemberian peran atau perubahan status keaktifan akun dicatat permanen dalam tabel{' '}
          <code>nexus_internal.audit_logs</code> dengan stempel waktu dan tanda tangan HMAC Gateway.
        </div>
      </div>

      {/* Tabel Direktori Pengguna */}
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
                  <th className="py-3 px-4">Nama Pengguna</th>
                  <th className="py-3 px-4">Peran Sistem</th>
                  <th className="py-3 px-4">Yurisdiksi Node</th>
                  <th className="py-3 px-4">Login Terakhir</th>
                  <th className="py-3 px-4">Status Akun</th>
                  <th className="py-3 px-4 text-right">Tindakan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 font-bold flex items-center justify-center text-xs shrink-0">
                          {u.fullName.charAt(0)}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900">{u.fullName}</div>
                          <div className="text-xs text-slate-500 font-mono">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center text-[11px] px-2.5 py-0.5 rounded-full font-bold border ${getRoleBadge(
                          u.role
                        )}`}
                      >
                        {getRoleLabel(u.role)}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-xs font-semibold text-slate-700">
                      {u.branchName || 'Kantor Pusat Korporat'}
                    </td>
                    <td className="py-3.5 px-4 text-xs font-mono text-slate-500">
                      {u.lastLoginAt}
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full font-semibold border ${
                          u.isActive
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                        }`}
                      >
                        {u.isActive ? (
                          <>
                            <CheckCircle2 className="w-3 h-3" />
                            Aktif
                          </>
                        ) : (
                          <>
                            <UserX className="w-3 h-3" />
                            Ditangguhkan
                          </>
                        )}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(u)}
                        disabled={u.id === user?.id}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          u.isActive
                            ? 'text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200'
                            : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200'
                        }`}
                      >
                        {u.isActive ? 'Tangguhkan' : 'Aktifkan'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Dialog Tambah Pengguna */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-100 p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Tambah Akun Pengguna Baru</h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateUser} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Nama Lengkap *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Raden Surya Subagio"
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Alamat Email Korporat *
                </label>
                <input
                  type="email"
                  required
                  placeholder="nama@nexus.local"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Peran Sistem (Kewenangan IAM) *
                </label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="EMPLOYEE">Karyawan (Portal Absensi Mandiri & Roster)</option>
                  <option value="BRANCH_MANAGER">Manajer Cabang (Operasional & Persetujuan Cuti)</option>
                  <option value="BRANCH_HR">HR Cabang (Personalia Cabang)</option>
                  <option value="CENTRAL_HR">HR Pusat (Personalia Korporat)</option>
                  <option value="SUPERADMIN">Superadmin Pusat (Akses Penuh Seluruh Sistem)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Alokasi Node Cabang *
                </label>
                <select
                  value={form.branchName}
                  onChange={(e) => setForm({ ...form, branchName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="Cabang A - Jakarta">Cabang A - Jakarta (uneycmbqqpkifwhwzbes)</option>
                  <option value="Kantor Pusat Korporat">Kantor Pusat Korporat (wcmevigbqsmzsdqidjel)</option>
                </select>
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-lg text-xs sm:text-sm text-slate-600 hover:bg-slate-100 font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg text-xs sm:text-sm text-white bg-blue-600 hover:bg-blue-700 font-semibold shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? 'Menyimpan...' : 'Simpan Pengguna'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
