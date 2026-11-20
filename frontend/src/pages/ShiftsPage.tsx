import React, { useEffect, useState } from 'react';
import {
  Clock,
  Coffee,
  Moon,
  Plus,
  Sun,
  Sunrise,
  Sunset,
  X,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../services/api';
import type { Shift } from '../types';

export const ShiftsPage: React.FC = () => {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    name: '',
    code: '',
    startTime: '08:00',
    endTime: '17:00',
    breakDurationMins: 60,
    isOvernight: false,
  });

  const canManage = user?.role === 'SUPERADMIN' || user?.role === 'BRANCH_MANAGER';

  const loadShifts = async () => {
    setLoading(true);
    try {
      const data = await api.getShifts();
      setShifts(data);
    } catch {
      showToast('error', 'Gagal memuat data konfigurasi shift.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadShifts();
  }, []);

  const handleCreateShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.code || !form.startTime || !form.endTime) {
      showToast('error', 'Silakan lengkapi seluruh kolom wajib shift.');
      return;
    }
    setSubmitting(true);
    try {
      await api.createShift({
        name: form.name,
        code: form.code.toUpperCase(),
        startTime: form.startTime,
        endTime: form.endTime,
        breakDurationMins: Number(form.breakDurationMins),
        isOvernight: form.isOvernight,
        isActive: true,
      });
      showToast('success', `Shift "${form.name}" berhasil dibuat.`);
      setShowModal(false);
      setForm({
        name: '',
        code: '',
        startTime: '08:00',
        endTime: '17:00',
        breakDurationMins: 60,
        isOvernight: false,
      });
      await loadShifts();
    } catch {
      showToast('error', 'Gagal menambahkan shift kerja.');
    } finally {
      setSubmitting(false);
    }
  };

  const getShiftIcon = (code: string) => {
    if (code.includes('PAGI') || code.includes('MORN'))
      return <Sunrise className="w-5 h-5 text-amber-500" />;
    if (code.includes('SIANG') || code.includes('OPS'))
      return <Sunset className="w-5 h-5 text-orange-500" />;
    if (code.includes('MALAM') || code.includes('NIGHT'))
      return <Moon className="w-5 h-5 text-indigo-500" />;
    return <Sun className="w-5 h-5 text-blue-500" />;
  };

  return (
    <div className="space-y-6">
      {/* Header Halaman */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Konfigurasi Shift Kerja
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Atur jam kerja standar cabang, rotasi shift malam, dan batasan durasi istirahat staf.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            Buat Template Shift
          </button>
        )}
      </div>

      {/* Grid Kartu Shift */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {shifts.map((shift) => (
            <div
              key={shift.id}
              className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                      {getShiftIcon(shift.code)}
                    </div>
                    <div>
                      <span className="text-[11px] font-mono font-bold text-blue-600">
                        {shift.code}
                      </span>
                      <h3 className="text-sm sm:text-base font-bold text-slate-900">
                        {shift.name}
                      </h3>
                    </div>
                  </div>
                  <span
                    className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold border ${
                      shift.isActive
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border-slate-200'
                    }`}
                  >
                    {shift.isActive ? 'Aktif' : 'Nonaktif'}
                  </span>
                </div>

                <div className="mt-4 space-y-2 bg-slate-50/70 p-3.5 rounded-xl border border-slate-100 text-xs">
                  <div className="flex items-center justify-between text-slate-600">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      Jam Kerja:
                    </span>
                    <span className="font-mono font-bold text-slate-900">
                      {shift.startTime} – {shift.endTime} WIB
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Coffee className="w-3.5 h-3.5 text-slate-400" />
                      Durasi Istirahat:
                    </span>
                    <span className="font-semibold text-slate-800">
                      {shift.breakDurationMins} menit
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Moon className="w-3.5 h-3.5 text-slate-400" />
                      Melewati Tengah Malam:
                    </span>
                    <span
                      className={`font-semibold ${
                        shift.isOvernight ? 'text-amber-600' : 'text-slate-500'
                      }`}
                    >
                      {shift.isOvernight ? 'Ya (Shift Malam)' : 'Tidak (Hari Sama)'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                <span>Node: Cabang A</span>
                <span className="text-blue-600 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Standar Kebijakan
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Dialog Buat Template Shift */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-100 p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Buat Template Shift Baru</h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateShift} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Nama Shift Kerja *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Shift Rotasi Akhir Pekan"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Kode Identifikasi Shift *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: ROT-WKD"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm uppercase focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Jam Mulai *
                  </label>
                  <input
                    type="time"
                    required
                    value={form.startTime}
                    onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Jam Berakhir *
                  </label>
                  <input
                    type="time"
                    required
                    value={form.endTime}
                    onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Alokasi Istirahat (Menit)
                </label>
                <input
                  type="number"
                  min="0"
                  max="180"
                  value={form.breakDurationMins}
                  onChange={(e) => setForm({ ...form, breakDurationMins: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="overnightCheck"
                  checked={form.isOvernight}
                  onChange={(e) => setForm({ ...form, isOvernight: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="overnightCheck" className="text-xs font-medium text-slate-700 cursor-pointer">
                  Shift Malam (waktu berakhir jatuh pada hari kalender berikutnya)
                </label>
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
                  {submitting ? 'Menyimpan...' : 'Simpan Shift'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
