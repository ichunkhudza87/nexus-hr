import React, { useEffect, useState } from 'react';
import {
  Building2,
  Briefcase,
  Plus,
  Search,
  Users,
  CheckCircle2,
  X,
  FolderPlus,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../services/api';
import type { Department, Position } from '../types';

export const DepartmentsPage: React.FC = () => {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'departments' | 'positions'>('departments');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Status modal
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [showPosModal, setShowPosModal] = useState(false);

  // Form
  const [deptForm, setDeptForm] = useState({ name: '', code: '', description: '' });
  const [posForm, setPosForm] = useState({ title: '', code: '', departmentId: '' });
  const [submitting, setSubmitting] = useState(false);

  const canManage = user?.role === 'SUPERADMIN' || user?.role === 'BRANCH_MANAGER';

  const loadData = async () => {
    setLoading(true);
    try {
      const [deptList, posList] = await Promise.all([
        api.getDepartments(),
        api.getPositions(),
      ]);
      setDepartments(deptList);
      setPositions(posList);
    } catch {
      showToast('error', 'Gagal memuat data struktur organisasi.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deptForm.name || !deptForm.code) {
      showToast('error', 'Silakan isi seluruh kolom wajib departemen.');
      return;
    }
    setSubmitting(true);
    try {
      await api.createDepartment({
        name: deptForm.name,
        code: deptForm.code.toUpperCase(),
        description: deptForm.description,
        isActive: true,
      });
      showToast('success', `Departemen "${deptForm.name}" berhasil dibuat.`);
      setShowDeptModal(false);
      setDeptForm({ name: '', code: '', description: '' });
      await loadData();
    } catch {
      showToast('error', 'Gagal menambahkan departemen.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddPosition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!posForm.title || !posForm.code || !posForm.departmentId) {
      showToast('error', 'Silakan lengkapi seluruh kolom jabatan.');
      return;
    }
    const dept = departments.find((d) => d.id === posForm.departmentId);
    setSubmitting(true);
    try {
      await api.createPosition({
        title: posForm.title,
        code: posForm.code.toUpperCase(),
        departmentId: posForm.departmentId,
        departmentName: dept?.name,
        isActive: true,
      });
      showToast('success', `Jabatan "${posForm.title}" berhasil ditambahkan.`);
      setShowPosModal(false);
      setPosForm({ title: '', code: '', departmentId: '' });
      await loadData();
    } catch {
      showToast('error', 'Gagal menambahkan jabatan.');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredDepartments = departments.filter(
    (d) =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.code.toLowerCase().includes(search.toLowerCase()) ||
      (d.description && d.description.toLowerCase().includes(search.toLowerCase()))
  );

  const filteredPositions = positions.filter(
    (p) =>
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.code.toLowerCase().includes(search.toLowerCase()) ||
      (p.departmentName && p.departmentName.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* Header Halaman & Aksi Cepat */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Departemen & Struktur Jabatan
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Pengelolaan divisi kerja korporat, unit fungsional, dan standardisasi jenjang posisi.
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowDeptModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors cursor-pointer"
            >
              <FolderPlus className="w-4 h-4" />
              Departemen Baru
            </button>
            <button
              type="button"
              onClick={() => setShowPosModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Jabatan Baru
            </button>
          </div>
        )}
      </div>

      {/* Tab Switcher & Bar Pencarian */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-fit">
          <button
            type="button"
            onClick={() => setActiveTab('departments')}
            className={`flex items-center gap-2 px-3.5 py-1.5 text-xs sm:text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'departments'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Building2 className="w-4 h-4 text-blue-600" />
            Departemen ({departments.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('positions')}
            className={`flex items-center gap-2 px-3.5 py-1.5 text-xs sm:text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'positions'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Briefcase className="w-4 h-4 text-blue-600" />
            Posisi Jabatan ({positions.length})
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder={`Cari ${activeTab === 'departments' ? 'departemen' : 'jabatan'}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 bg-white text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Konten Tab */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : activeTab === 'departments' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDepartments.map((dept) => (
            <div
              key={dept.id}
              className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[11px] font-mono font-bold uppercase px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200">
                    {dept.code}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="w-3 h-3" />
                    Aktif
                  </span>
                </div>
                <h3 className="text-base font-bold text-slate-900 mt-2.5">{dept.name}</h3>
                <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                  {dept.description || 'Tidak ada deskripsi lingkup divisi.'}
                </p>
              </div>

              <div className="mt-5 pt-3.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                <span className="flex items-center gap-1.5 font-medium">
                  <Users className="w-4 h-4 text-slate-400" />
                  Karyawan: <strong className="text-slate-900 font-bold">{dept.employeeCount}</strong>
                </span>
                <span className="text-slate-400 text-[11px]">Cabang A - Jakarta</span>
              </div>
            </div>
          ))}
          {filteredDepartments.length === 0 && (
            <div className="col-span-full py-12 text-center text-slate-500 bg-white rounded-xl border border-slate-200">
              Tidak ada departemen yang sesuai dengan &quot;{search}&quot;.
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs sm:text-sm min-w-140">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  <th className="py-3 px-4">Kode Posisi</th>
                  <th className="py-3 px-4">Nama Posisi Jabatan</th>
                  <th className="py-3 px-4">Departemen Terkait</th>
                  <th className="py-3 px-4 text-center">Staf Aktif</th>
                  <th className="py-3 px-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPositions.map((pos) => (
                  <tr key={pos.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-xs text-blue-600">
                      {pos.code}
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-900">{pos.title}</td>
                    <td className="py-3 px-4 text-slate-600">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 text-xs font-medium text-slate-700">
                        <Building2 className="w-3.5 h-3.5 text-slate-400" />
                        {pos.departmentName || 'Divisi Umum'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center font-bold text-slate-900 font-mono">
                      {pos.employeeCount}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" />
                        Aktif
                      </span>
                    </td>
                  </tr>
                ))}
                {filteredPositions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-500">
                      Tidak ada jabatan yang sesuai dengan &quot;{search}&quot;.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Tambah Departemen */}
      {showDeptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-100 p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Tambah Departemen Baru</h3>
              <button
                type="button"
                onClick={() => setShowDeptModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddDepartment} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Nama Departemen *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Operasional & Fasilitas"
                  value={deptForm.name}
                  onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Kode Departemen *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: OPS"
                  value={deptForm.code}
                  onChange={(e) => setDeptForm({ ...deptForm, code: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm uppercase focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Deskripsi Divisi
                </label>
                <textarea
                  rows={3}
                  placeholder="Ruang lingkup tanggung jawab departemen..."
                  value={deptForm.description}
                  onChange={(e) => setDeptForm({ ...deptForm, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowDeptModal(false)}
                  className="px-4 py-2 rounded-lg text-xs sm:text-sm text-slate-600 hover:bg-slate-100 font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg text-xs sm:text-sm text-white bg-blue-600 hover:bg-blue-700 font-semibold shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? 'Menyimpan...' : 'Simpan Departemen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Tambah Jabatan */}
      {showPosModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-100 p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Tambah Jabatan Baru</h3>
              <button
                type="button"
                onClick={() => setShowPosModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddPosition} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Judul Jabatan *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Database Administrator Lead"
                  value={posForm.title}
                  onChange={(e) => setPosForm({ ...posForm, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Kode Jabatan *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: DBA-LEAD"
                  value={posForm.code}
                  onChange={(e) => setPosForm({ ...posForm, code: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm uppercase focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Departemen Terkait *
                </label>
                <select
                  required
                  value={posForm.departmentId}
                  onChange={(e) => setPosForm({ ...posForm, departmentId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Pilih Departemen...</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.code})
                    </option>
                  ))}
                </select>
              </div>
              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowPosModal(false)}
                  className="px-4 py-2 rounded-lg text-xs sm:text-sm text-slate-600 hover:bg-slate-100 font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg text-xs sm:text-sm text-white bg-blue-600 hover:bg-blue-700 font-semibold shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? 'Menyimpan...' : 'Simpan Jabatan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
