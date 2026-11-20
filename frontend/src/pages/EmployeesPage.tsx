import React, { useEffect, useState } from 'react';
import {
  Search,
  Plus,
  Building2,
  Mail,
  Phone,
  X,
  CheckCircle2,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { formatDate, getEmploymentStatusLabel } from '../utils/formatters';
import type { Department, Employee, EmploymentStatus, Position } from '../types';

export const EmployeesPage: React.FC = () => {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter & Pencarian
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Modal Tambah Karyawan
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phoneNumber: '',
    departmentId: '',
    positionId: '',
    employmentStatus: 'PERMANENT' as EmploymentStatus,
    joinDate: new Date().toISOString().split('T')[0] ?? '2026-11-12',
    branchId: '00000000-0000-0000-0000-000000000001',
    branchName: 'Cabang A - Jakarta',
  });

  const canManage = user?.role === 'SUPERADMIN' || user?.role === 'BRANCH_MANAGER';

  const loadData = async () => {
    setLoading(true);
    try {
      const [empRes, deptRes, posRes] = await Promise.all([
        api.getEmployees({ search, departmentId, page, limit: 8 }),
        api.getDepartments(),
        api.getPositions(),
      ]);
      setEmployees(empRes.data);
      setTotalPages(empRes.totalPages);
      setTotalCount(empRes.totalCount);
      setDepartments(deptRes);
      setPositions(posRes);
    } catch {
      showToast('error', 'Gagal memuat data direktori karyawan.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [search, departmentId, page]);

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fullName || !form.email || !form.departmentId || !form.positionId) {
      showToast('error', 'Silakan lengkapi seluruh kolom wajib.');
      return;
    }

    const dept = departments.find((d) => d.id === form.departmentId);
    const pos = positions.find((p) => p.id === form.positionId);

    setSubmitting(true);
    try {
      await api.createEmployee({
        fullName: form.fullName,
        email: form.email,
        phoneNumber: form.phoneNumber || '+62 812-0000-0000',
        departmentId: form.departmentId,
        departmentName: dept?.name || 'Umum',
        positionId: form.positionId,
        positionTitle: pos?.title || 'Staf',
        employmentStatus: form.employmentStatus,
        joinDate: form.joinDate,
        branchId: form.branchId,
        branchName: form.branchName,
      });

      showToast('success', `Data karyawan ${form.fullName} berhasil ditambahkan.`);
      setShowModal(false);
      setForm({
        fullName: '',
        email: '',
        phoneNumber: '',
        departmentId: '',
        positionId: '',
        employmentStatus: 'PERMANENT',
        joinDate: new Date().toISOString().split('T')[0] ?? '2026-11-12',
        branchId: '00000000-0000-0000-0000-000000000001',
        branchName: 'Cabang A - Jakarta',
      });
      loadData();
    } catch {
      showToast('error', 'Gagal menyimpan data karyawan.');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: EmploymentStatus) => {
    switch (status) {
      case 'PERMANENT':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'CONTRACT':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'PROBATION':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'INTERN':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Halaman & Aksi Tambah */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Data Karyawan & Personalia
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Kelola profil kepegawaian, status kontrak kerja, dan penugasan divisi operasional.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            Tambah Karyawan
          </button>
        )}
      </div>

      {/* Toolbar Pencarian & Filter */}
      <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
          {/* Kolom Input Cari */}
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Cari nama, NIK, atau email..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Filter Dropdown Departemen */}
          <div className="w-full sm:w-56">
            <select
              value={departmentId}
              onChange={(e) => {
                setDepartmentId(e.target.value);
                setPage(1);
              }}
              aria-label="Filter berdasarkan departemen"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs sm:text-sm bg-white text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Semua Departemen ({departments.length})</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="text-xs text-slate-500 font-medium w-full sm:w-auto text-right">
          Total: <strong className="text-slate-800 font-bold">{totalCount}</strong> karyawan aktif
        </div>
      </div>

      {/* Tabel Data Karyawan */}
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
                  <th className="py-3 px-4">Karyawan</th>
                  <th className="py-3 px-4">Kontak</th>
                  <th className="py-3 px-4">Departemen & Posisi</th>
                  <th className="py-3 px-4">Status Hubungan</th>
                  <th className="py-3 px-4">Mulai Bergabung</th>
                  <th className="py-3 px-4 text-center">Keaktifan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-50/60 transition-colors">
                    {/* Nama & NIK */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 font-bold flex items-center justify-center text-xs shrink-0 border border-slate-200">
                          {emp.fullName.charAt(0)}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900">{emp.fullName}</div>
                          <div className="text-[11px] font-mono text-slate-500">
                            NIK: {emp.employeeCode}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Kontak */}
                    <td className="py-3.5 px-4 text-xs text-slate-600">
                      <div className="flex items-center gap-1.5 truncate">
                        <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{emp.email}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-400 text-[11px] mt-0.5">
                        <Phone className="w-3 h-3 shrink-0" />
                        <span>{emp.phoneNumber || '+62 812-xxxx-xxxx'}</span>
                      </div>
                    </td>

                    {/* Departemen & Posisi */}
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-800">{emp.positionTitle}</div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                        <Building2 className="w-3 h-3 text-slate-400" />
                        <span>{emp.departmentName}</span>
                      </div>
                    </td>

                    {/* Status Kepegawaian */}
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center text-[11px] px-2.5 py-0.5 rounded-full font-semibold border ${getStatusBadge(
                          emp.employmentStatus
                        )}`}
                      >
                        {getEmploymentStatusLabel(emp.employmentStatus)}
                      </span>
                    </td>

                    {/* Tanggal Bergabung */}
                    <td className="py-3.5 px-4 text-xs font-mono text-slate-600">
                      {formatDate(emp.joinDate)}
                    </td>

                    {/* Keaktifan */}
                    <td className="py-3.5 px-4 text-center">
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" />
                        Aktif
                      </span>
                    </td>
                  </tr>
                ))}

                {employees.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-500">
                      Tidak ada karyawan yang sesuai dengan kriteria pencarian &quot;{search}&quot;.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Bar Navigasi Pagination */}
        <div className="px-4 py-3 border-t border-slate-200/80 bg-slate-50/50 flex items-center justify-between text-xs">
          <div className="text-slate-500">
            Halaman <span className="font-bold text-slate-800">{page}</span> dari{' '}
            <span className="font-bold text-slate-800">{totalPages}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
            >
              Sebelumnya
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
            >
              Selanjutnya
            </button>
          </div>
        </div>
      </div>

      {/* Modal Dialog Tambah Karyawan */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-100 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Tambah Data Karyawan Baru</h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateEmployee} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Nama Lengkap *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Raden Surya Nugraha"
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Email Korporat *
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
                    Nomor WhatsApp / HP
                  </label>
                  <input
                    type="tel"
                    placeholder="+62 812-xxxx-xxxx"
                    value={form.phoneNumber}
                    onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Departemen *
                  </label>
                  <select
                    required
                    value={form.departmentId}
                    onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Pilih Departemen...</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Jabatan Kerja *
                  </label>
                  <select
                    required
                    value={form.positionId}
                    onChange={(e) => setForm({ ...form, positionId: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Pilih Jabatan...</option>
                    {positions
                      .filter((p) => !form.departmentId || p.departmentId === form.departmentId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Status Kepegawaian *
                  </label>
                  <select
                    value={form.employmentStatus}
                    onChange={(e) =>
                      setForm({ ...form, employmentStatus: e.target.value as EmploymentStatus })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="PERMANENT">Karyawan Tetap</option>
                    <option value="CONTRACT">Kontrak (PKWT)</option>
                    <option value="PROBATION">Masa Percobaan</option>
                    <option value="INTERN">Magang</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Tanggal Mulai Tugas *
                  </label>
                  <input
                    type="date"
                    required
                    value={form.joinDate}
                    onChange={(e) => setForm({ ...form, joinDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
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
                  {submitting ? 'Menyimpan...' : 'Simpan Karyawan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
