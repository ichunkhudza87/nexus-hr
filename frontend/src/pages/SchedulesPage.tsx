import React, { useEffect, useState } from 'react';
import {
  Calendar as CalendarIcon,
  Clock,
  Filter,
  Plus,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../services/api';
import { formatDate, getScheduleStatusLabel } from '../utils/formatters';
import type { Employee, Schedule, Shift } from '../types';

export const SchedulesPage: React.FC = () => {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter
  const [selectedEmpFilter, setSelectedEmpFilter] = useState('');
  const [selectedDateFilter, setSelectedDateFilter] = useState('');

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    employeeId: '',
    shiftId: '',
    scheduleDate: '2026-11-12',
    notes: '',
  });

  const canAssign = user?.role === 'SUPERADMIN' || user?.role === 'BRANCH_MANAGER';
  const isEmployee = user?.role === 'EMPLOYEE';

  const loadData = async () => {
    setLoading(true);
    try {
      const [schedList, empList, shiftList] = await Promise.all([
        api.getSchedules({ employeeId: selectedEmpFilter || undefined }),
        api.getEmployees({ limit: 50 }),
        api.getShifts(),
      ]);
      setSchedules(schedList);
      setEmployees(empList.data);
      setShifts(shiftList);
    } catch {
      showToast('error', 'Gagal memuat data jadwal roster kerja.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedEmpFilter]);

  const handleAssignSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.employeeId || !form.shiftId || !form.scheduleDate) {
      showToast('error', 'Silakan pilih karyawan, template shift, dan tanggal tugas.');
      return;
    }
    const emp = employees.find((e) => e.id === form.employeeId);
    const shift = shifts.find((s) => s.id === form.shiftId);
    if (!emp || !shift) return;

    setSubmitting(true);
    try {
      await api.assignSchedule({
        employeeId: emp.id,
        employeeName: emp.fullName,
        employeeCode: emp.employeeCode,
        departmentName: emp.departmentName,
        shiftId: shift.id,
        shiftName: shift.name,
        startTime: shift.startTime,
        endTime: shift.endTime,
        scheduleDate: form.scheduleDate,
        status: 'SCHEDULED',
        notes: form.notes || null,
      });
      showToast(
        'success',
        `Jadwal shift berhasil ditugaskan ke ${emp.fullName} pada ${formatDate(form.scheduleDate)}.`
      );
      setShowModal(false);
      setForm({
        employeeId: '',
        shiftId: '',
        scheduleDate: '2026-11-12',
        notes: '',
      });
      await loadData();
    } catch {
      showToast('error', 'Gagal menugaskan jadwal shift.');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: Schedule['status']) => {
    switch (status) {
      case 'SCHEDULED':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'LEAVE':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'OFF':
        return 'bg-slate-100 text-slate-600 border-slate-200';
      case 'SWAPPED':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      default:
        return 'bg-slate-50 text-slate-600 border-slate-200';
    }
  };

  const filteredSchedules = schedules.filter((s) => {
    if (selectedDateFilter && s.scheduleDate !== selectedDateFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header Halaman */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Jadwal & Roster Kerja
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {isEmployee
              ? 'Rincian alokasi shift kerja dan jadwal penugasan operasional Anda.'
              : 'Perencanaan roster mingguan, alokasi giliran shift staf, dan kontinuitas layanan cabang.'}
          </p>
        </div>
        {canAssign && (
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            Tugaskan Shift
          </button>
        )}
      </div>

      {/* Bar Filter */}
      <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200/80 shadow-xs flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
          <Filter className="w-4 h-4 text-blue-600" />
          Filter:
        </div>

        {!isEmployee && (
          <div className="w-full sm:w-60">
            <select
              value={selectedEmpFilter}
              onChange={(e) => setSelectedEmpFilter(e.target.value)}
              aria-label="Pilih Karyawan"
              className="w-full text-xs sm:text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Semua Karyawan ({employees.length})</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName} ({e.employeeCode})
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="w-full sm:w-48">
          <input
            type="date"
            value={selectedDateFilter}
            onChange={(e) => setSelectedDateFilter(e.target.value)}
            aria-label="Pilih Tanggal Roster"
            className="w-full text-xs sm:text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {selectedDateFilter && (
          <button
            type="button"
            onClick={() => setSelectedDateFilter('')}
            className="text-xs text-blue-600 hover:underline font-semibold"
          >
            Hapus Filter Tanggal
          </button>
        )}

        <div className="ml-auto text-xs text-slate-500 font-medium">
          Menampilkan <strong className="text-slate-900 font-bold">{filteredSchedules.length}</strong> jadwal tugas
        </div>
      </div>

      {/* Grid Kartu Roster */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSchedules.map((s) => (
            <div
              key={s.id}
              className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4 text-blue-600" />
                    <span className="text-xs sm:text-sm font-bold text-slate-900">
                      {formatDate(s.scheduleDate)}
                    </span>
                  </div>
                  <span
                    className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold border ${getStatusBadge(
                      s.status
                    )}`}
                  >
                    {getScheduleStatusLabel(s.status)}
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 font-bold flex items-center justify-center text-xs">
                        {s.employeeName.charAt(0)}
                      </div>
                      <div>
                        <p className="text-xs sm:text-sm font-bold text-slate-900">
                          {s.employeeName}
                        </p>
                        <p className="text-[11px] text-slate-500 font-mono">
                          NIK: {s.employeeCode}
                        </p>
                      </div>
                    </div>
                    <span className="text-[11px] font-medium text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-md">
                      {s.departmentName}
                    </span>
                  </div>

                  <div className="bg-slate-50/70 p-3 rounded-xl border border-slate-100 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-slate-700 font-medium">
                      <Clock className="w-3.5 h-3.5 text-blue-600" />
                      <span>{s.shiftName}</span>
                    </div>
                    <span className="font-mono font-bold text-slate-900">
                      {s.startTime} – {s.endTime} WIB
                    </span>
                  </div>

                  {s.notes && (
                    <p className="text-xs text-slate-500 italic bg-amber-50/50 border border-amber-100 p-2 rounded-lg">
                      Catatan: &ldquo;{s.notes}&rdquo;
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-400 flex items-center justify-between">
                <span>Node: Cabang A</span>
                <span className="text-slate-600 font-medium">Roster Terverifikasi</span>
              </div>
            </div>
          ))}

          {filteredSchedules.length === 0 && (
            <div className="col-span-full py-16 text-center text-slate-500 bg-white rounded-xl border border-slate-200">
              Tidak ada jadwal kerja yang sesuai dengan filter yang dipilih.
            </div>
          )}
        </div>
      )}

      {/* Modal Dialog Tugaskan Shift */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-100 p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Tugaskan Shift Kerja</h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAssignSchedule} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Pilih Karyawan *
                </label>
                <select
                  required
                  value={form.employeeId}
                  onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">Pilih Karyawan...</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.fullName} ({emp.employeeCode} - {emp.departmentName})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Template Shift Kerja *
                </label>
                <select
                  required
                  value={form.shiftId}
                  onChange={(e) => setForm({ ...form, shiftId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">Pilih Shift...</option>
                  {shifts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.startTime} - {s.endTime} WIB)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Tanggal Penugasan *
                </label>
                <input
                  type="date"
                  required
                  value={form.scheduleDate}
                  onChange={(e) => setForm({ ...form, scheduleDate: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Catatan Supervisi (Opsional)
                </label>
                <input
                  type="text"
                  placeholder="Contoh: Penggantian jadwal rotasi cabang Jakarta"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
                />
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
                  {submitting ? 'Menyimpan...' : 'Tugaskan Shift'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
