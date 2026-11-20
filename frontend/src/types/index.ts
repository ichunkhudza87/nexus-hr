export type UserRole = 'SUPERADMIN' | 'BRANCH_MANAGER' | 'EMPLOYEE' | 'CENTRAL_HR' | 'BRANCH_HR';

export type EmploymentStatus = 'PERMANENT' | 'CONTRACT' | 'INTERN' | 'PROBATION';

export type LeaveType = 'ANNUAL' | 'SICK' | 'MATERNITY' | 'UNPAID' | 'SPECIAL_PERMISSION';

export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export type ScheduleStatus = 'SCHEDULED' | 'SWAPPED' | 'CANCELLED' | 'LEAVE' | 'OFF';

export type AttendanceStatus = 'ON_TIME' | 'LATE' | 'EARLY_DEPARTURE' | 'OVERTIME' | 'INCOMPLETE' | 'ABSENT';

export interface UserSession {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  branchId: string | null;
  branchName: string | null;
  employeeId: string | null;
  employeeCode?: string;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  employeeCount: number;
  isActive: boolean;
  description?: string;
}

export interface Position {
  id: string;
  departmentId: string;
  departmentName?: string;
  title: string;
  code: string;
  employeeCount: number;
  isActive: boolean;
}

export interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  email: string;
  phoneNumber?: string;
  departmentId: string;
  departmentName: string;
  positionId: string;
  positionTitle: string;
  employmentStatus: EmploymentStatus;
  joinDate: string;
  resignationDate?: string | null;
  isActive: boolean;
  branchId: string;
  branchName: string;
}

export interface Shift {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  isOvernight: boolean;
  breakDurationMins: number;
  isActive: boolean;
}

export interface Schedule {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  departmentName: string;
  shiftId: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  scheduleDate: string;
  status: ScheduleStatus;
  notes?: string | null;
}

export interface AttendanceRecord {
  id: string;
  scheduleId: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  departmentName: string;
  attendanceDate: string;
  checkInTime: string;
  checkOutTime?: string | null;
  status: AttendanceStatus;
  lateMinutes: number;
  checkInMethod: string;
  checkOutMethod?: string | null;
  isVerified: boolean;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  departmentName: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  status: LeaveStatus;
  submittedAt: string;
  approvedBy?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  rejectionReason?: string | null;
}

export interface DashboardSummary {
  totalEmployees: number;
  presentCount: number;
  lateCount: number;
  absentCount: number;
  leaveCount: number;
  attendanceRate: number;
  recentActivity: Array<{
    id: string;
    employeeName: string;
    action: string;
    timestamp: string;
    status: string;
  }>;
  departmentDistribution: Array<{
    name: string;
    count: number;
    percentage: number;
  }>;
  weeklyTrend: Array<{
    date: string;
    day: string;
    present: number;
    late: number;
    absent: number;
    leave: number;
  }>;
}

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface UserAccount {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  branchName: string | null;
  isActive: boolean;
  lastLoginAt: string;
}

