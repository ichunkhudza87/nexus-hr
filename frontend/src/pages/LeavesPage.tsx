import React, { useEffect, useState } from 'react';
import {
  Filter,
  Plus,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../services/api';
import {
  formatDate,
  getLeaveStatusLabel,
  getLeaveTypeLabel,
} from '../utils/formatters';
import type { LeaveRequest, LeaveType } from '../types';

export const LeavesPage: React.FC = () => {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  // Modals
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [showDecideModal, setShowDecideModal] = useState(false);
  const [activeRequest, setActiveRequest] = useState<LeaveRequest | null>(null);

  // Form Pengajuan
  const [applyForm, setApplyForm] = useState({
    leaveType: 'ANNUAL' as LeaveType,
    startDate: '2026-11-20',
    endDate: '2026-11-22',
    totalDays: 3,
    reason: '',
  });

  const [rejectionReason, setRejectionReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canDecide = user?.role === 'SUPERADMIN' || user?.role === 'BRANCH_MANAGER';
  const isEmployee = user?.role === 'EMPLOYEE';

  const loadRequests = async () => {
    setLoading(true);
    try {
      const data = await api.getLeaveRequests({
        status: statusFilter || undefined,
      });
      setRequests(data);
    } catch {
      showToast('error', 'Gagal memuat daftar permohonan cuti.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRequests();
  }, [statusFilter]);

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!applyForm.reason.trim()) {
      showToast('error', 'Silakan berikan alasan dan justifikasi pengajuan cuti.');
      return;
    }
    setSubmitting(true);
    try {
      await api.submitLeaveRequest({
        leaveType: applyForm.leaveType,
        startDate: applyForm.startDate,
        endDate: applyForm.endDate,
        totalDays: Number(applyForm.totalDays),
        reason: applyForm.reason,
      });
      showToast(
        'success',
        'Permohonan cuti berhasil diajukan dan sedang menunggu peninjauan.'
      );
      setShowApplyModal(false);
      setApplyForm({
        leaveType: 'ANNUAL',
        startDate: '2026-11-20',
        endDate: '2026-11-22',
        totalDays: 3,
        reason: '',
      });
      await loadRequests();
    } catch {
      showToast('error', 'Gagal mengajukan permohonan cuti.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecide = async (decision: 'APPROVED' | 'REJECTED') => {
    if (!activeRequest) return;
    if (decision === 'REJECTED' && !rejectionReason.trim()) {
      showToast('error', 'Wajib mencantumkan alasan penolakan.');
      return;
    }

    // Pengecekan sisi klien selaras dengan RPC SQL v2.7.1 rpc_branch_decide_leave_request
    if (user?.role === 'BRANCH_MANAGER' && activeRequest.employeeId === user.employeeId) {
      showToast(
        'error',
        'Kebijakan Keamanan: Persetujuan mandiri oleh Manajer Cabang dilarang keras.'
      );
      return;
    }

    setSubmitting(true);
    try {
      await api.decideLeaveRequest(activeRequest.id, decision, rejectionReason);
      const actionText = decision === 'APPROVED' ? 'disetujui' : 'ditolak';
      showToast(
        'success',
        `Permohonan cuti #${activeRequest.id.substring(0, 8)} telah ${actionText}.`
      );
      setShowDecideModal(false);
      setActiveRequest(null);
      setRejectionReason('');
      await loadRequests();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memperbarui status permohonan.';
      showToast('error', msg);
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: LeaveRequest['status']) => {
    switch (status) {
      case 'APPROVED':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'PENDING':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'REJECTED':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Halaman */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Pengajuan & Persetujuan Cuti
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {isEmployee
              ? 'Ajukan cuti tahunan, cuti sakit, atau izin khusus dan pantau status persetujuannya.'
              : 'Verifikasi pengajuan cuti staf, tinjau kecukupan roster, dan berikan keputusan.'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowApplyModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          Ajukan Cuti Baru
        </button>
      </div>

      {/* Toolbar Filter Status */}
      <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-bold uppercase text-slate-500">Filter Status:</span>
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            {[
              { val: '', label: 'Semua Status' },
              { val: 'PENDING', label: 'Menunggu' },
              { val: 'APPROVED', label: 'Disetujui' },
              { val: 'REJECTED', label: 'Ditolak' },
            ].map((st) => (
              <button
                key={st.val || 'all'}
                type="button"
                onClick={() => setStatusFilter(st.val)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  statusFilter === st.val
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>

        <div className="text-xs text-slate-500 font-medium">
          Total: <strong className="text-slate-900 font-bold">{requests.length}</strong> pengajuan cuti
        </div>
      </div>

      {/* Tabel Pengajuan Cuti */}
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
                  <th className="py-3 px-4">Karyawan Pemohon</th>
                  <th className="py-3 px-4">Kategori Cuti</th>
                  <th className="py-3 px-4">Periode & Durasi</th>
                  <th className="py-3 px-4">Alasan / Keterangan</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Diputuskan Oleh</th>
                  {canDecide && <th className="py-3 px-4 text-right">Tindakan</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requests.map((r) => {
                  const isOwnRequest = user?.employeeId === r.employeeId;
                  const isBranchManager = user?.role === 'BRANCH_MANAGER';
                  const isBlockedFromApproving = isBranchManager && isOwnRequest;

                  return (
                    <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3.5 px-4">
                        <div>
                          <div className="font-bold text-slate-900">{r.employeeName}</div>
                          <div className="text-[11px] font-mono text-slate-500">
                            NIK: {r.employeeCode} • {r.departmentName}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="text-[11px] font-semibold text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded-md">
                          {getLeaveTypeLabel(r.leaveType)}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-xs">
                        <div className="font-semibold text-slate-900">
                          {formatDate(r.startDate)} s/d {formatDate(r.endDate)}
                        </div>
                        <span className="text-blue-600 font-bold text-[11px]">
                          {r.totalDays} hari kerja
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-600 max-w-xs truncate">
                        {r.reason}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center text-[11px] px-2.5 py-0.5 rounded-full font-semibold border ${getStatusBadge(
                            r.status
                          )}`}
                        >
                          {getLeaveStatusLabel(r.status)}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-500">
                        {r.approvedByName ? (
                          <div>
                            <span className="font-semibold text-slate-800">
                              {r.approvedByName}
                            </span>
                            {r.approvedAt && (
                              <div className="text-[10px] text-slate-400 font-mono">
                                {formatDate(r.approvedAt)}
                              </div>
                            )}
                          </div>
                        ) : r.rejectionReason ? (
                          <span className="text-rose-600 font-medium italic">
                            Ditolak: {r.rejectionReason}
                          </span>
                        ) : (
                          <span className="text-slate-400">Menunggu Tinjauan</span>
                        )}
                      </td>
                      {canDecide && (
                        <td className="py-3.5 px-4 text-right">
                          {r.status === 'PENDING' ? (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveRequest(r);
                                setShowDecideModal(true);
                              }}
                              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                                isBlockedFromApproving
                                  ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
                                  : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'
                              }`}
                            >
                              {isBlockedFromApproving ? 'Permohonan Mandiri' : 'Tinjau'}
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400 font-medium">Selesai</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
                {requests.length === 0 && (
                  <tr>
                    <td colSpan={canDecide ? 7 : 6} className="py-12 text-center text-slate-500">
                      Tidak ada permohonan cuti yang tercatat.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Dialog Ajukan Cuti */}
      {showApplyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-100 p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Formulir Pengajuan Cuti</h3>
              <button
                type="button"
                onClick={() => setShowApplyModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleApply} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Kategori Cuti *
                </label>
                <select
                  value={applyForm.leaveType}
                  onChange={(e) =>
                    setApplyForm({ ...applyForm, leaveType: e.target.value as LeaveType })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="ANNUAL">Cuti Tahunan (Hak Cuti Resmi)</option>
                  <option value="SICK">Cuti Sakit / Surat Dokter</option>
                  <option value="SPECIAL_PERMISSION">Izin Khusus / Keperluan Mendesak</option>
                  <option value="UNPAID">Cuti di Luar Tanggungan</option>
                  <option value="MATERNITY">Cuti Melahirkan</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Tanggal Mulai *
                  </label>
                  <input
                    type="date"
                    required
                    value={applyForm.startDate}
                    onChange={(e) => setApplyForm({ ...applyForm, startDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Tanggal Selesai *
                  </label>
                  <input
                    type="date"
                    required
                    value={applyForm.endDate}
                    onChange={(e) => setApplyForm({ ...applyForm, endDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Jumlah Hari Kerja Efektif *
                </label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  required
                  value={applyForm.totalDays}
                  onChange={(e) => setApplyForm({ ...applyForm, totalDays: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Alasan & Justifikasi Pengajuan *
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="Jelaskan keperluan dan detail pengajuan izin..."
                  value={applyForm.reason}
                  onChange={(e) => setApplyForm({ ...applyForm, reason: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowApplyModal(false)}
                  className="px-4 py-2 rounded-lg text-xs sm:text-sm text-slate-600 hover:bg-slate-100 font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg text-xs sm:text-sm text-white bg-blue-600 hover:bg-blue-700 font-semibold shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? 'Mengirim...' : 'Kirim Pengajuan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Dialog Keputusan Cuti (Reviewer) */}
      {showDecideModal && activeRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-100 p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                Tinjau Permohonan Cuti Karyawan
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowDecideModal(false);
                  setActiveRequest(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Nama Pemohon:</span>
                  <span className="font-bold text-slate-900">{activeRequest.employeeName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Departemen:</span>
                  <span className="font-bold text-slate-900">{activeRequest.departmentName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Kategori Cuti:</span>
                  <span className="font-bold text-blue-600">
                    {getLeaveTypeLabel(activeRequest.leaveType)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Periode:</span>
                  <span className="font-bold text-slate-900">
                    {formatDate(activeRequest.startDate)} s/d {formatDate(activeRequest.endDate)} (
                    {activeRequest.totalDays} hari kerja)
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-200">
                  <span className="text-slate-500 block mb-1">Alasan Pengajuan:</span>
                  <p className="text-slate-800 italic bg-white p-2.5 rounded-lg border border-slate-200">
                    &ldquo;{activeRequest.reason}&rdquo;
                  </p>
                </div>
              </div>

              {/* Peringatan Kebijakan Keamanan: Self-Approval Prohibition */}
              {user?.role === 'BRANCH_MANAGER' && activeRequest.employeeId === user.employeeId ? (
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-xs text-rose-800">
                  <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div className="leading-relaxed">
                    <strong className="block font-bold">Persetujuan Mandiri Dilarang</strong>
                    Berdasarkan aturan keamanan PostgreSQL v2.7.1 (
                    <code>rpc_branch_decide_leave_request</code>), Manajer Cabang dilarang keras menyetujui atau menolak permohonan cuti miliknya sendiri. Permohonan ini harus diputuskan oleh Superadmin Pusat.
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>
                    Keputusan akan ditandatangani Gateway HMAC dan dicatat permanen dalam{' '}
                    <code>nexus_internal.audit_logs</code>.
                  </span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Alasan Penolakan (Wajib jika permohonan ditolak)
                </label>
                <input
                  type="text"
                  placeholder="Contoh: Kebutuhan cakupan staf kritis untuk rilis sistem"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowDecideModal(false);
                    setActiveRequest(null);
                  }}
                  className="px-4 py-2 rounded-lg text-xs sm:text-sm text-slate-600 hover:bg-slate-100 font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={
                    submitting ||
                    (user?.role === 'BRANCH_MANAGER' && activeRequest.employeeId === user.employeeId)
                  }
                  onClick={() => handleDecide('REJECTED')}
                  className="px-4 py-2 rounded-lg text-xs sm:text-sm text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 font-bold disabled:opacity-50 cursor-pointer"
                >
                  Tolak Cuti
                </button>
                <button
                  type="button"
                  disabled={
                    submitting ||
                    (user?.role === 'BRANCH_MANAGER' && activeRequest.employeeId === user.employeeId)
                  }
                  onClick={() => handleDecide('APPROVED')}
                  className="px-4 py-2 rounded-lg text-xs sm:text-sm text-white bg-emerald-600 hover:bg-emerald-700 font-bold shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  Setujui Cuti
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
