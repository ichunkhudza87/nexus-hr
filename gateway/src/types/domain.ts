export const USER_ROLES = [
  'SUPERADMIN',
  'CENTRAL_HR',
  'BRANCH_MANAGER',
  'BRANCH_HR',
  'EMPLOYEE',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const LEAVE_TYPES = [
  'ANNUAL',
  'SICK',
  'MATERNITY',
  'UNPAID',
  'SPECIAL_PERMISSION',
] as const;

export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;

export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const CANONICAL_ACTOR_PAYLOAD_VERSION = 'v2.7' as const;

export type ActionScope = 'LEAVE_DECIDE' | 'LEAVE_SUPERADMIN_UPDATE';
export type OperationMode = 'DECISION' | 'CORRECTION';

export interface VerifiedJwtClaims {
  sub: string;
  email?: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nbf?: number;
  jti?: string;
}

export interface CentralUserProfile {
  id: string;
  email: string;
  role: UserRole;
  branch_id: string | null;
  is_active: boolean;
  branch?: {
    id: string;
    code: string;
    is_active: boolean;
  } | null;
}

export interface BranchEmployeeRecord {
  id: string;
  user_auth_id: string | null;
  is_active: boolean;
  is_deleted: boolean;
}

export interface ResolvedActor {
  actorUserId: string;
  actorEmail: string;
  actorRole: UserRole;
  branchId: string | null;
  employeeId: string | null;
}

export interface HmacSigningKeyRecord {
  keyId: string;
  secret: string;
  isActive: boolean;
  createdAt: string;
  activatedAt?: string;
  rotatedAt: string | null;
  expiresAt?: string | null;
  revokedAt: string | null;
}

export interface SignedActorEnvelope {
  keyId: string;
  actionScope: ActionScope;
  targetId: string;
  operationMode: OperationMode;
  actorUserId: string;
  actorEmail: string;
  actorRole: UserRole;
  branchId: string | null;
  employeeId: string | null;
  exp: number;
  nonce: string;
  actorSig: string;
}

export interface LeaveDecisionInput {
  requestId: string;
  decision: 'APPROVED' | 'REJECTED';
  rejectionReason: string | null;
}

export interface SuperadminLeaveUpdateInput {
  requestId: string;
  operationMode: OperationMode;
  employeeId?: string | null;
  leaveType?: LeaveType | null;
  startDate?: string | null;
  endDate?: string | null;
  totalDays?: number | null;
  reason?: string | null;
  status?: LeaveStatus | null;
  rejectionReason?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
}

export interface LeaveRequestRecord {
  id: string;
  employee_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string;
  status: LeaveStatus;
  submitted_at: string;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export const EMPLOYMENT_STATUSES = ['PERMANENT', 'CONTRACT', 'INTERN', 'PROBATION'] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const SCHEDULE_STATUSES = ['SCHEDULED', 'SWAPPED', 'CANCELLED', 'LEAVE', 'OFF'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const ATTENDANCE_STATUSES = [
  'ON_TIME',
  'LATE',
  'EARLY_DEPARTURE',
  'OVERTIME',
  'INCOMPLETE',
  'ABSENT',
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export type SortDir = 'asc' | 'desc';

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number | null;
}

export interface DashboardSummaryQuery extends PaginationParams {
  branchId?: string;
  startDate?: string;
  endDate?: string;
  sortBy: 'summary_date' | 'total_employees' | 'present_count' | 'late_count';
  sortDir: SortDir;
}

export interface EmployeeDirectoryQuery extends PaginationParams {
  branchId?: string;
  isActive?: boolean;
  employmentStatus?: EmploymentStatus;
  search?: string;
  sortBy: 'full_name' | 'employee_code' | 'join_date' | 'created_at';
  sortDir: SortDir;
}

export interface BranchEmployeesQuery extends PaginationParams {
  employeeId?: string;
  departmentId?: string;
  isActive?: boolean;
  employmentStatus?: EmploymentStatus;
  sortBy: 'full_name' | 'employee_code' | 'join_date' | 'created_at';
  sortDir: SortDir;
}

export interface ShiftsQuery extends PaginationParams {
  isActive?: boolean;
  sortBy: 'code' | 'name' | 'start_time';
  sortDir: SortDir;
}

export interface SchedulesQuery extends PaginationParams {
  employeeId?: string;
  startDate?: string;
  endDate?: string;
  status?: ScheduleStatus;
  sortBy: 'schedule_date' | 'created_at';
  sortDir: SortDir;
}

export interface AttendanceQuery extends PaginationParams {
  employeeId?: string;
  startDate?: string;
  endDate?: string;
  status?: AttendanceStatus;
  sortBy: 'attendance_date' | 'check_in_time';
  sortDir: SortDir;
}

export interface LeaveRequestsQuery extends PaginationParams {
  employeeId?: string;
  startDate?: string;
  endDate?: string;
  status?: LeaveStatus;
  leaveType?: LeaveType;
  sortBy: 'submitted_at' | 'start_date' | 'created_at';
  sortDir: SortDir;
}

export interface AttendanceDailySummaryRecord {
  id: string;
  branch_id: string;
  summary_date: string;
  total_employees: number;
  present_count: number;
  late_count: number;
  absent_count: number;
  leave_count: number;
  last_synced_at: string;
}

export interface EmployeeDirectoryRecord {
  id: string;
  branch_id: string;
  employee_code: string;
  full_name: string;
  email: string | null;
  department_name: string | null;
  position_title: string | null;
  employment_status: EmploymentStatus;
  join_date: string;
  is_active: boolean;
  last_synced_at: string;
}

export interface BranchEmployeeDetailRecord {
  id: string;
  employee_code: string;
  user_auth_id: string | null;
  department_id: string;
  position_id: string;
  full_name: string;
  email: string;
  phone_number: string | null;
  employment_status: EmploymentStatus;
  join_date: string;
  resignation_date: string | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface ShiftRecord {
  id: string;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  is_overnight: boolean;
  break_duration_mins: number;
  is_active: boolean;
}

export interface EmployeeScheduleRecord {
  id: string;
  employee_id: string;
  shift_id: string;
  schedule_date: string;
  status: ScheduleStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceRecord {
  id: string;
  schedule_id: string;
  employee_id: string;
  attendance_date: string;
  check_in_time: string;
  check_out_time: string | null;
  status: AttendanceStatus;
  check_in_method: string;
  check_out_method: string | null;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}
