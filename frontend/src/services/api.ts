import type {
  AttendanceRecord,
  DashboardSummary,
  Department,
  Employee,
  LeaveRequest,
  PaginatedResponse,
  Position,
  Schedule,
  Shift,
  UserAccount,
  UserRole,
  UserSession,
} from '../types';
import {
  MOCK_ATTENDANCE,
  MOCK_DASHBOARD_SUMMARY,
  MOCK_DEPARTMENTS,
  MOCK_EMPLOYEES,
  MOCK_LEAVE_REQUESTS,
  MOCK_POSITIONS,
  MOCK_SCHEDULES,
  MOCK_SHIFTS,
  MOCK_USERS,
} from './mock-data';
import { getCentralAccessToken, getSupabaseClient } from './supabase';

// Helper for simulated latency in mock mode
const delay = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ApiClient {
  getCurrentUser(): Promise<UserSession | null>;
  login(roleKey: 'superadmin' | 'manager' | 'employee'): Promise<UserSession>;
  loginWithCredentials?(email: string, password: string): Promise<UserSession>;
  switchRole(role: UserRole): Promise<UserSession>;
  logout(): Promise<void>;
  getDashboardSummary(): Promise<DashboardSummary>;
  getEmployees(params?: {
    search?: string;
    departmentId?: string;
    page?: number;
    pageSize?: number;
    limit?: number;
  }): Promise<PaginatedResponse<Employee>>;
  createEmployee(input: Omit<Employee, 'id' | 'employeeCode' | 'isActive'>): Promise<Employee>;
  updateEmployee(id: string, updates: Partial<Employee>): Promise<Employee>;
  getDepartments(): Promise<Department[]>;
  createDepartment(input: Omit<Department, 'id' | 'employeeCount'>): Promise<Department>;
  getPositions(): Promise<Position[]>;
  createPosition(input: Omit<Position, 'id' | 'employeeCount'>): Promise<Position>;
  getShifts(): Promise<Shift[]>;
  createShift(input: Omit<Shift, 'id'>): Promise<Shift>;
  getSchedules(params?: {
    startDate?: string;
    endDate?: string;
    employeeId?: string;
  }): Promise<Schedule[]>;
  assignSchedule(input: Omit<Schedule, 'id'>): Promise<Schedule>;
  getAttendance(params?: {
    date?: string;
    employeeId?: string;
    status?: string;
  }): Promise<AttendanceRecord[]>;
  recordCheckIn(employeeId: string): Promise<AttendanceRecord>;
  getLeaveRequests(params?: {
    status?: string;
    employeeId?: string;
  }): Promise<LeaveRequest[]>;
  submitLeaveRequest(input: {
    leaveType: LeaveRequest['leaveType'];
    startDate: string;
    endDate: string;
    totalDays: number;
    reason: string;
  }): Promise<LeaveRequest>;
  decideLeaveRequest(
    leaveId: string,
    decision: 'APPROVED' | 'REJECTED',
    rejectionReason?: string,
  ): Promise<LeaveRequest>;
  getUsers(): Promise<UserAccount[]>;
  createUserAccount(input: Omit<UserAccount, 'id' | 'lastLoginAt'>): Promise<UserAccount>;
  toggleUserStatus(id: string): Promise<UserAccount>;
}

export function isLiveApiMode(): boolean {
  const mode = import.meta.env.VITE_API_MODE;
  const useMock = import.meta.env.VITE_USE_MOCK_API;
  return mode === 'live' || useMock === 'false';
}

export function getApiMode(): 'live' | 'mock' {
  return isLiveApiMode() ? 'live' : 'mock';
}

class MockStorage implements ApiClient {
  private employees: Employee[] = [...MOCK_EMPLOYEES];
  private departments: Department[] = [...MOCK_DEPARTMENTS];
  private positions: Position[] = [...MOCK_POSITIONS];
  private shifts: Shift[] = [...MOCK_SHIFTS];
  private schedules: Schedule[] = [...MOCK_SCHEDULES];
  private attendance: AttendanceRecord[] = [...MOCK_ATTENDANCE];
  private leaveRequests: LeaveRequest[] = [...MOCK_LEAVE_REQUESTS];
  private currentUser: UserSession = MOCK_USERS.superadmin;
  private users: UserAccount[] = [
    {
      id: '00000000-0000-0000-0000-00000000000a',
      email: 'admin@nexus.local',
      fullName: 'Alexander Wright',
      role: 'SUPERADMIN',
      branchName: 'Kantor Pusat Korporat',
      isActive: true,
      lastLoginAt: '2026-11-12 08:30:00',
    },
    {
      id: '00000000-0000-0000-0000-00000000000b',
      email: 'manager.jkt@nexus.local',
      fullName: 'Dewi Lestari',
      role: 'BRANCH_MANAGER',
      branchName: 'Cabang A - Jakarta',
      isActive: true,
      lastLoginAt: '2026-11-12 07:45:00',
    },
    {
      id: '00000000-0000-0000-0000-00000000000c',
      email: 'budi.santoso@nexus.local',
      fullName: 'Budi Santoso',
      role: 'EMPLOYEE',
      branchName: 'Cabang A - Jakarta',
      isActive: true,
      lastLoginAt: '2026-11-12 08:02:15',
    },
    {
      id: '00000000-0000-0000-0000-00000000000d',
      email: 'siti.nurhaliza@nexus.local',
      fullName: 'Siti Nurhaliza',
      role: 'EMPLOYEE',
      branchName: 'Cabang A - Jakarta',
      isActive: true,
      lastLoginAt: '2026-11-12 08:14:02',
    },
  ];

  constructor() {
    // Restore session from localStorage if present
    const savedUser = localStorage.getItem('nexus_demo_user');
    if (savedUser) {
      try {
        this.currentUser = JSON.parse(savedUser) as UserSession;
      } catch {
        this.currentUser = MOCK_USERS.superadmin;
      }
    }
  }

  async getCurrentUser(): Promise<UserSession | null> {
    await delay(50);
    return this.currentUser;
  }

  async login(roleKey: 'superadmin' | 'manager' | 'employee'): Promise<UserSession> {
    await delay(200);
    const user = MOCK_USERS[roleKey];
    if (!user) throw new Error('Invalid user');
    this.currentUser = user;
    localStorage.setItem('nexus_demo_user', JSON.stringify(user));
    return user;
  }

  async loginWithCredentials(email: string): Promise<UserSession> {
    await delay(200);
    const low = email.toLowerCase();
    let roleKey: 'superadmin' | 'manager' | 'employee' = 'employee';
    if (low.includes('admin')) roleKey = 'superadmin';
    else if (low.includes('manager')) roleKey = 'manager';
    return this.login(roleKey);
  }

  async switchRole(role: UserRole): Promise<UserSession> {
    await delay(100);
    let matched = Object.values(MOCK_USERS).find((u) => u.role === role);
    if (!matched) matched = MOCK_USERS.superadmin;
    this.currentUser = matched;
    localStorage.setItem('nexus_demo_user', JSON.stringify(matched));
    return matched;
  }

  async logout(): Promise<void> {
    await delay(50);
    this.currentUser = MOCK_USERS.superadmin;
    localStorage.removeItem('nexus_demo_user');
  }

  // Dashboard
  async getDashboardSummary(): Promise<DashboardSummary> {
    await delay(150);
    return MOCK_DASHBOARD_SUMMARY;
  }

  // Employees
  async getEmployees(params?: {
    search?: string;
    departmentId?: string;
    page?: number;
    pageSize?: number;
    limit?: number;
  }): Promise<PaginatedResponse<Employee>> {
    await delay(150);
    let filtered = [...this.employees];

    if (this.currentUser.role === 'EMPLOYEE') {
      filtered = filtered.filter((e) => e.id === this.currentUser.employeeId);
    }

    if (params?.search) {
      const q = params.search.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.fullName.toLowerCase().includes(q) ||
          e.employeeCode.toLowerCase().includes(q) ||
          e.email.toLowerCase().includes(q),
      );
    }
    if (params?.departmentId) {
      filtered = filtered.filter((e) => e.departmentId === params.departmentId);
    }

    const page = params?.page ?? 1;
    const pageSize = params?.limit ?? params?.pageSize ?? 10;
    const totalCount = filtered.length;
    const totalPages = Math.ceil(totalCount / pageSize) || 1;
    const start = (page - 1) * pageSize;
    const data = filtered.slice(start, start + pageSize);

    return { data, page, pageSize, totalCount, totalPages };
  }

  async createEmployee(input: Omit<Employee, 'id' | 'employeeCode' | 'isActive'>): Promise<Employee> {
    await delay(200);
    const newCode = `EMP-A-${String(this.employees.length + 1).padStart(4, '0')}`;
    const newEmp: Employee = {
      ...input,
      id: `emp-new-${Date.now()}`,
      employeeCode: newCode,
      isActive: true,
    };
    this.employees.unshift(newEmp);
    return newEmp;
  }

  async updateEmployee(id: string, updates: Partial<Employee>): Promise<Employee> {
    await delay(150);
    const index = this.employees.findIndex((e) => e.id === id);
    if (index === -1) throw new Error('Employee not found');
    this.employees[index] = { ...this.employees[index]!, ...updates };
    return this.employees[index]!;
  }

  // Departments & Positions
  async getDepartments(): Promise<Department[]> {
    await delay(100);
    return this.departments;
  }

  async createDepartment(input: Omit<Department, 'id' | 'employeeCount'>): Promise<Department> {
    await delay(150);
    const newDept: Department = {
      ...input,
      id: `dept-${Date.now()}`,
      employeeCount: 0,
    };
    this.departments.push(newDept);
    return newDept;
  }

  async getPositions(): Promise<Position[]> {
    await delay(100);
    return this.positions;
  }

  async createPosition(input: Omit<Position, 'id' | 'employeeCount'>): Promise<Position> {
    await delay(150);
    const newPos: Position = {
      ...input,
      id: `pos-${Date.now()}`,
      employeeCount: 0,
    };
    this.positions.push(newPos);
    return newPos;
  }

  // Shifts
  async getShifts(): Promise<Shift[]> {
    await delay(100);
    return this.shifts;
  }

  async createShift(input: Omit<Shift, 'id'>): Promise<Shift> {
    await delay(150);
    const newShift: Shift = { ...input, id: `shift-${Date.now()}` };
    this.shifts.push(newShift);
    return newShift;
  }

  // Schedules
  async getSchedules(params?: {
    startDate?: string;
    endDate?: string;
    employeeId?: string;
  }): Promise<Schedule[]> {
    await delay(150);
    let list = [...this.schedules];
    if (this.currentUser.role === 'EMPLOYEE') {
      list = list.filter((s) => s.employeeId === this.currentUser.employeeId);
    } else if (params?.employeeId) {
      list = list.filter((s) => s.employeeId === params.employeeId);
    }
    return list;
  }

  async assignSchedule(input: Omit<Schedule, 'id'>): Promise<Schedule> {
    await delay(150);
    const newSched: Schedule = { ...input, id: `sched-${Date.now()}` };
    this.schedules.unshift(newSched);
    return newSched;
  }

  // Attendance
  async getAttendance(params?: {
    date?: string;
    employeeId?: string;
    status?: string;
  }): Promise<AttendanceRecord[]> {
    await delay(150);
    let list = [...this.attendance];
    if (this.currentUser.role === 'EMPLOYEE') {
      list = list.filter((a) => a.employeeId === this.currentUser.employeeId);
    } else if (params?.employeeId) {
      list = list.filter((a) => a.employeeId === params.employeeId);
    }
    if (params?.date) {
      list = list.filter((a) => a.attendanceDate === params.date);
    }
    if (params?.status) {
      list = list.filter((a) => a.status === params.status);
    }
    return list;
  }

  async recordCheckIn(employeeId: string): Promise<AttendanceRecord> {
    await delay(200);
    const emp = this.employees.find((e) => e.id === employeeId);
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] ?? '08:00:00';
    const dateStr = now.toISOString().split('T')[0] ?? '2026-11-12';
    const newRecord: AttendanceRecord = {
      id: `att-${Date.now()}`,
      scheduleId: 'sched-1',
      employeeId,
      employeeName: emp?.fullName ?? 'Current Employee',
      employeeCode: emp?.employeeCode ?? 'EMP-A-LIVE',
      departmentName: emp?.departmentName ?? 'Teknologi & Rekayasa Sistem',
      attendanceDate: dateStr,
      checkInTime: timeStr,
      checkOutTime: null,
      status: 'ON_TIME',
      lateMinutes: 0,
      checkInMethod: 'WEB_APP',
      checkOutMethod: null,
      isVerified: true,
    };
    this.attendance.unshift(newRecord);
    return newRecord;
  }

  // Leave Requests
  async getLeaveRequests(params?: {
    status?: string;
    employeeId?: string;
  }): Promise<LeaveRequest[]> {
    await delay(150);
    let list = [...this.leaveRequests];
    if (this.currentUser.role === 'EMPLOYEE') {
      list = list.filter((l) => l.employeeId === this.currentUser.employeeId);
    } else if (params?.employeeId) {
      list = list.filter((l) => l.employeeId === params.employeeId);
    }
    if (params?.status) {
      list = list.filter((l) => l.status === params.status);
    }
    return list;
  }

  async submitLeaveRequest(input: {
    leaveType: LeaveRequest['leaveType'];
    startDate: string;
    endDate: string;
    totalDays: number;
    reason: string;
  }): Promise<LeaveRequest> {
    await delay(200);
    const emp = this.employees.find((e) => e.id === this.currentUser.employeeId) ?? this.employees[1]!;
    const newLeave: LeaveRequest = {
      id: `leave-${Date.now()}`,
      employeeId: emp.id,
      employeeName: emp.fullName,
      employeeCode: emp.employeeCode,
      departmentName: emp.departmentName,
      leaveType: input.leaveType,
      startDate: input.startDate,
      endDate: input.endDate,
      totalDays: input.totalDays,
      reason: input.reason,
      status: 'PENDING',
      submittedAt: new Date().toISOString(),
    };
    this.leaveRequests.unshift(newLeave);
    return newLeave;
  }

  async decideLeaveRequest(
    leaveId: string,
    decision: 'APPROVED' | 'REJECTED',
    rejectionReason?: string,
  ): Promise<LeaveRequest> {
    await delay(200);
    const index = this.leaveRequests.findIndex((l) => l.id === leaveId);
    if (index === -1) throw new Error('Leave request not found');

    const req = this.leaveRequests[index]!;
    if (this.currentUser.role === 'BRANCH_MANAGER' && req.employeeId === this.currentUser.employeeId) {
      throw new Error('Persetujuan mandiri oleh Manajer Cabang dilarang oleh kebijakan keamanan sistem.');
    }

    const updated: LeaveRequest = {
      ...req,
      status: decision,
      approvedBy: this.currentUser.id,
      approvedByName: this.currentUser.fullName,
      approvedAt: new Date().toISOString(),
      rejectionReason: decision === 'REJECTED' ? rejectionReason ?? 'No reason provided' : null,
    };
    this.leaveRequests[index] = updated;
    return updated;
  }

  async getUsers(): Promise<UserAccount[]> {
    await delay(100);
    return [...this.users];
  }

  async createUserAccount(input: Omit<UserAccount, 'id' | 'lastLoginAt'>): Promise<UserAccount> {
    await delay(150);
    const newUser: UserAccount = {
      ...input,
      id: `usr-${Date.now()}`,
      lastLoginAt: 'Never',
    };
    this.users.push(newUser);
    return newUser;
  }

  async toggleUserStatus(id: string): Promise<UserAccount> {
    await delay(100);
    const user = this.users.find((u) => u.id === id);
    if (!user) throw new Error('User not found');
    user.isActive = !user.isActive;
    return user;
  }
}

class LiveApiClient implements ApiClient {
  private readonly baseUrl: string;
  private currentUser: UserSession | null = null;

  getCurrentSession(): UserSession | null {
    return this.currentUser;
  }

  constructor() {
    this.baseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const savedUser = localStorage.getItem('nexus_demo_user');
    if (savedUser) {
      try {
        this.currentUser = JSON.parse(savedUser) as UserSession;
      } catch {
        this.currentUser = MOCK_USERS.employee;
      }
    }
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const token = await getCentralAccessToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers as Record<string, string>),
    };

    try {
      const res = await fetch(url, { ...options, headers });
      if (!res.ok) {
        let errMessage = `HTTP ${res.status}`;
        let errCode = '';
        try {
          const errBody = await res.json();
          if (errBody?.error?.message) errMessage = errBody.error.message;
          if (errBody?.error?.code) errCode = errBody.error.code;
        } catch {
          // keep fallback
        }
        if (res.status === 401) {
          window.dispatchEvent(new CustomEvent('nexus:session-expired', { detail: { message: errMessage } }));
        }
        const error = new Error(errMessage);
        (error as any).status = res.status;
        (error as any).code = errCode;
        throw error;
      }
      const data = await res.json();
      return (data?.data !== undefined ? data.data : data) as T;
    } catch (err) {
      console.error(`[Live API Error] ${endpoint}:`, err);
      throw err;
    }
  }

  async getCurrentUser(): Promise<UserSession | null> {
    const token = await getCentralAccessToken();
    if (!token) {
      this.currentUser = null as any;
      localStorage.removeItem('nexus_jwt_token');
      localStorage.removeItem('nexus_demo_user');
      return null;
    }
    try {
      const actor = await this.request<{
        id: string;
        email: string;
        role: UserRole;
        branchId: string | null;
        employeeId: string | null;
      }>('/api/me');

      const session: UserSession = {
        id: actor.id,
        email: actor.email,
        fullName: actor.email.split('@')[0].replace('.', ' ').toUpperCase(),
        role: actor.role,
        branchId: actor.branchId || '00000000-0000-0000-0000-000000000001',
        branchName: actor.branchId ? 'Cabang A - Jakarta' : 'Kantor Pusat Korporat',
        employeeId: actor.employeeId || null,
      };
      this.currentUser = session;
      localStorage.setItem('nexus_demo_user', JSON.stringify(session));
      return session;
    } catch (err) {
      console.warn('[LiveApiClient] /api/me actor resolution failed:', err);
      this.currentUser = null as any;
      localStorage.removeItem('nexus_jwt_token');
      localStorage.removeItem('nexus_demo_user');
      return null;
    }
  }

  async loginWithCredentials(email: string, pass: string): Promise<UserSession> {
    const sb = getSupabaseClient();
    if (!sb) {
      throw new Error('Supabase Client belum terkonfigurasi pada frontend.');
    }
    const { data, error } = await sb.auth.signInWithPassword({
      email,
      password: pass,
    });
    if (error || !data.session) {
      throw new Error(error?.message || 'Autentikasi gagal pada Central Supabase Auth.');
    }
    localStorage.setItem('nexus_jwt_token', data.session.access_token);
    const user = await this.getCurrentUser();
    if (!user) {
      throw new Error('Gagal memverifikasi identitas pengguna melalui Gateway.');
    }
    return user;
  }

  async login(roleKey: 'superadmin' | 'manager' | 'employee'): Promise<UserSession> {
    const user = MOCK_USERS[roleKey];
    if (!user) throw new Error('Invalid user');
    this.currentUser = user;
    localStorage.setItem('nexus_demo_user', JSON.stringify(user));
    return user;
  }

  async switchRole(role: UserRole): Promise<UserSession> {
    let matched = Object.values(MOCK_USERS).find((u) => u.role === role);
    if (!matched) matched = MOCK_USERS.superadmin;
    this.currentUser = matched;
    localStorage.setItem('nexus_demo_user', JSON.stringify(matched));
    return matched;
  }

  async logout(): Promise<void> {
    const sb = getSupabaseClient();
    if (sb) {
      await sb.auth.signOut().catch(() => {});
    }
    this.currentUser = null as any;
    localStorage.removeItem('nexus_jwt_token');
    localStorage.removeItem('nexus_demo_user');
  }

  async getDashboardSummary(): Promise<DashboardSummary> {
    try {
      const summaries = await this.request<any[]>('/api/dashboard/summary');
      if (Array.isArray(summaries) && summaries.length > 0) {
        const latest = summaries[0];
        const total = latest.total_employees ?? MOCK_DASHBOARD_SUMMARY.totalEmployees;
        const present = latest.present_count ?? MOCK_DASHBOARD_SUMMARY.presentCount;
        const late = latest.late_count ?? MOCK_DASHBOARD_SUMMARY.lateCount;
        return {
          ...MOCK_DASHBOARD_SUMMARY,
          totalEmployees: total,
          presentCount: present,
          lateCount: late,
          absentCount: latest.absent_count ?? MOCK_DASHBOARD_SUMMARY.absentCount,
          leaveCount: latest.leave_count ?? MOCK_DASHBOARD_SUMMARY.leaveCount,
          attendanceRate: total > 0 ? Math.round(((present + late) / total) * 100) : 100,
        };
      }
    } catch {
      // Return baseline if endpoint has no summaries yet
    }
    return MOCK_DASHBOARD_SUMMARY;
  }

  async getEmployees(params?: {
    search?: string;
    departmentId?: string;
    page?: number;
    pageSize?: number;
    limit?: number;
  }): Promise<PaginatedResponse<Employee>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    const size = params?.limit ?? params?.pageSize;
    if (size) searchParams.set('limit', String(size));
    if (params?.departmentId) searchParams.set('department_id', params.departmentId);

    const result = await this.request<{ items: any[]; total?: number; totalCount?: number; page: number; pageSize: number }>(
      `/api/employees?${searchParams.toString()}`,
    );

    let data: Employee[] = (result.items || []).map((e) => ({
      id: e.id,
      employeeCode: e.employee_code,
      fullName: e.full_name,
      email: e.email,
      departmentId: e.department_id,
      departmentName: e.department_name ?? 'Teknologi & Rekayasa Sistem',
      positionId: e.position_id,
      positionTitle: e.position_title ?? 'Senior Backend Engineer',
      employmentStatus: e.employment_status,
      joinDate: e.join_date,
      isActive: e.is_active,
      branchId: '00000000-0000-0000-0000-000000000001',
      branchName: 'Cabang A - Jakarta',
    }));

    if (params?.search && params.search.trim() !== '') {
      const q = params.search.toLowerCase();
      data = data.filter(
        (e) =>
          e.fullName.toLowerCase().includes(q) ||
          e.employeeCode.toLowerCase().includes(q) ||
          e.email.toLowerCase().includes(q),
      );
    }

    const totalCount = result.totalCount ?? result.total ?? data.length;
    const effectivePageSize = result.pageSize || size || 10;
    return {
      data,
      page: result.page || params?.page || 1,
      pageSize: effectivePageSize,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / effectivePageSize)),
    };
  }

  async createEmployee(input: Omit<Employee, 'id' | 'employeeCode' | 'isActive'>): Promise<Employee> {
    return this.request<Employee>('/api/employees', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async updateEmployee(id: string, updates: Partial<Employee>): Promise<Employee> {
    return this.request<Employee>(`/api/employees/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async getDepartments(): Promise<Department[]> {
    try {
      return await this.request<Department[]>('/api/departments');
    } catch (err: any) {
      if (err?.status === 404 || err?.message?.includes('404') || err?.code === 'ROUTE_NOT_FOUND') {
        console.warn('[GATEWAY_BLOCKER] GET /api/departments belum tersedia di Backend Gateway. Menggunakan data fallback mock untuk UI.');
        return [...MOCK_DEPARTMENTS];
      }
      throw err;
    }
  }

  async createDepartment(input: Omit<Department, 'id' | 'employeeCount'>): Promise<Department> {
    try {
      return await this.request<Department>('/api/departments', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    } catch (err: any) {
      if (err?.status === 404 || err?.code === 'ROUTE_NOT_FOUND') {
        throw new Error('Pembuatan departemen via Gateway belum diimplementasikan (Blocker: Route POST /api/departments tidak tersedia).');
      }
      throw err;
    }
  }

  async getPositions(): Promise<Position[]> {
    try {
      return await this.request<Position[]>('/api/positions');
    } catch (err: any) {
      if (err?.status === 404 || err?.message?.includes('404') || err?.code === 'ROUTE_NOT_FOUND') {
        console.warn('[GATEWAY_BLOCKER] GET /api/positions belum tersedia di Backend Gateway. Menggunakan data fallback mock untuk UI.');
        return [...MOCK_POSITIONS];
      }
      throw err;
    }
  }

  async createPosition(input: Omit<Position, 'id' | 'employeeCount'>): Promise<Position> {
    try {
      return await this.request<Position>('/api/positions', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    } catch (err: any) {
      if (err?.status === 404 || err?.code === 'ROUTE_NOT_FOUND') {
        throw new Error('Pembuatan posisi via Gateway belum diimplementasikan (Blocker: Route POST /api/positions tidak tersedia).');
      }
      throw err;
    }
  }

  async getShifts(): Promise<Shift[]> {
    const result = await this.request<{ items: any[] }>('/api/shifts');
    return (result.items || []).map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      startTime: s.start_time,
      endTime: s.end_time,
      isOvernight: s.is_overnight,
      breakDurationMins: s.break_duration_mins,
      isActive: s.is_active,
    }));
  }

  async createShift(input: Omit<Shift, 'id'>): Promise<Shift> {
    return this.request<Shift>('/api/shifts', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async getSchedules(params?: {
    startDate?: string;
    endDate?: string;
    employeeId?: string;
  }): Promise<Schedule[]> {
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.set('startDate', params.startDate);
    if (params?.endDate) searchParams.set('endDate', params.endDate);
    if (params?.employeeId) searchParams.set('employeeId', params.employeeId);

    const result = await this.request<{ items: any[] }>(`/api/schedules?${searchParams.toString()}`);
    return (result.items || []).map((s) => ({
      id: s.id,
      employeeId: s.employee_id,
      employeeName: s.employee_name ?? 'Karyawan Cabang',
      employeeCode: s.employee_code ?? 'EMP-A',
      departmentName: s.department_name ?? 'Operasional',
      shiftId: s.shift_id,
      shiftName: s.shift_name ?? 'Shift Pagi Reguler',
      startTime: s.start_time ?? '08:00',
      endTime: s.end_time ?? '17:00',
      scheduleDate: s.schedule_date,
      status: s.status,
    }));
  }

  async assignSchedule(input: Omit<Schedule, 'id'>): Promise<Schedule> {
    return this.request<Schedule>('/api/schedules', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async getAttendance(params?: {
    date?: string;
    employeeId?: string;
    status?: string;
  }): Promise<AttendanceRecord[]> {
    const searchParams = new URLSearchParams();
    if (params?.date) searchParams.set('date', params.date);
    if (params?.employeeId) searchParams.set('employeeId', params.employeeId);
    if (params?.status) searchParams.set('status', params.status);

    const result = await this.request<{ items: any[] }>(`/api/attendance?${searchParams.toString()}`);
    return (result.items || []).map((a) => ({
      id: a.id,
      scheduleId: a.schedule_id,
      employeeId: a.employee_id,
      employeeName: a.employee_name ?? 'Budi Santoso',
      employeeCode: a.employee_code ?? 'EMP-A-0002',
      departmentName: a.department_name ?? 'Teknologi & Rekayasa Sistem',
      attendanceDate: a.attendance_date,
      checkInTime: a.check_in_time ? a.check_in_time.split('T')[1]?.slice(0, 8) ?? a.check_in_time : '08:00:00',
      checkOutTime: a.check_out_time ? a.check_out_time.split('T')[1]?.slice(0, 8) ?? a.check_out_time : null,
      status: a.status,
      lateMinutes: a.status === 'LATE' ? 12 : 0,
      checkInMethod: a.check_in_method || 'MANUAL_WEB',
      checkOutMethod: a.check_out_method,
      isVerified: a.is_verified ?? true,
    }));
  }

  async recordCheckIn(employeeId: string): Promise<AttendanceRecord> {
    try {
      return await this.request<AttendanceRecord>('/api/attendance/check-in', {
        method: 'POST',
        body: JSON.stringify({ employeeId }),
      });
    } catch (err: any) {
      if (err?.status === 404 || err?.code === 'ROUTE_NOT_FOUND') {
        throw new Error('Pencatatan check-in via Gateway belum diimplementasikan (Blocker Tahap 1: Route POST /api/attendance/check-in tidak tersedia pada Gateway).');
      }
      throw err;
    }
  }

  async getLeaveRequests(params?: {
    status?: string;
    employeeId?: string;
  }): Promise<LeaveRequest[]> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.employeeId) searchParams.set('employeeId', params.employeeId);

    const result = await this.request<{ items: any[] }>(`/api/leave-requests?${searchParams.toString()}`);
    return (result.items || []).map((l) => ({
      id: l.id,
      employeeId: l.employee_id,
      employeeName: l.employee_name ?? 'Karyawan Cabang',
      employeeCode: l.employee_code ?? 'EMP-A',
      departmentName: l.department_name ?? 'Operasional',
      leaveType: l.leave_type,
      startDate: l.start_date,
      endDate: l.end_date,
      totalDays: l.total_days,
      reason: l.reason,
      status: l.status,
      submittedAt: l.created_at,
    }));
  }

  async submitLeaveRequest(input: {
    leaveType: LeaveRequest['leaveType'];
    startDate: string;
    endDate: string;
    totalDays: number;
    reason: string;
  }): Promise<LeaveRequest> {
    return this.request<LeaveRequest>('/api/leave-requests', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async decideLeaveRequest(
    leaveId: string,
    decision: 'APPROVED' | 'REJECTED',
    rejectionReason?: string,
  ): Promise<LeaveRequest> {
    return this.request<LeaveRequest>(`/api/v1/leave-requests/${leaveId}/decide`, {
      method: 'POST',
      body: JSON.stringify({
        decision,
        rejectionReason: decision === 'REJECTED' ? rejectionReason : undefined,
      }),
    });
  }

  async getUsers(): Promise<UserAccount[]> {
    try {
      return await this.request<UserAccount[]>('/api/users');
    } catch (err: any) {
      if (err?.status === 404 || err?.message?.includes('404') || err?.code === 'ROUTE_NOT_FOUND') {
        console.warn('[GATEWAY_BLOCKER] GET /api/users belum tersedia di Backend Gateway. Menggunakan data fallback mock.');
        return [
          {
            id: '00000000-0000-0000-0000-00000000000a',
            email: 'admin@nexus.local',
            fullName: 'Alexander Wright',
            role: 'SUPERADMIN',
            branchName: 'Kantor Pusat Korporat',
            isActive: true,
            lastLoginAt: '2026-11-12 08:30:00',
          },
          {
            id: '00000000-0000-0000-0000-00000000000b',
            email: 'manager.jkt@nexus.local',
            fullName: 'Dewi Lestari',
            role: 'BRANCH_MANAGER',
            branchName: 'Cabang A - Jakarta',
            isActive: true,
            lastLoginAt: '2026-11-12 07:45:00',
          },
          {
            id: '00000000-0000-0000-0000-00000000000c',
            email: 'budi.santoso@nexus.local',
            fullName: 'Budi Santoso',
            role: 'EMPLOYEE',
            branchName: 'Cabang A - Jakarta',
            isActive: true,
            lastLoginAt: '2026-11-12 08:02:15',
          },
        ];
      }
      throw err;
    }
  }

  async createUserAccount(input: Omit<UserAccount, 'id' | 'lastLoginAt'>): Promise<UserAccount> {
    return this.request<UserAccount>('/api/users', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async toggleUserStatus(id: string): Promise<UserAccount> {
    return this.request<UserAccount>(`/api/users/${id}/status`, {
      method: 'PATCH',
    });
  }
}

export const api: ApiClient = isLiveApiMode() ? new LiveApiClient() : new MockStorage();
