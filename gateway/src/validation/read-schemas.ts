import { GatewayError } from '../errors/gateway-error.ts';
import {
  ATTENDANCE_STATUSES,
  EMPLOYMENT_STATUSES,
  LEAVE_STATUSES,
  LEAVE_TYPES,
  SCHEDULE_STATUSES,
} from '../types/domain.ts';
import type {
  AttendanceQuery,
  AttendanceStatus,
  BranchEmployeesQuery,
  DashboardSummaryQuery,
  EmployeeDirectoryQuery,
  EmploymentStatus,
  LeaveRequestsQuery,
  LeaveStatus,
  LeaveType,
  SchedulesQuery,
  ScheduleStatus,
  ShiftsQuery,
  SortDir,
} from '../types/domain.ts';
import { assertValidUuid } from './leave-schemas.ts';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_SEARCH_REGEX = /^[A-Za-z0-9\s._@-]{1,100}$/;
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const FORBIDDEN_QUERY_KEYS = new Set([
  'role',
  'user_role',
  'actor_id',
  'actor_user_id',
  'actor_role',
  'actor_email',
  'actor_sig',
]);

function assertNoForbiddenQueryParams(params: URLSearchParams): void {
  for (const key of params.keys()) {
    if (FORBIDDEN_QUERY_KEYS.has(key.toLowerCase())) {
      throw new GatewayError(
        400,
        'FORBIDDEN_IDENTITY_FIELD',
        `Query parameter '${key}' is not permitted.`,
      );
    }
  }
}

function assertAllowedQueryParams(params: URLSearchParams, allowed: Set<string>): void {
  assertNoForbiddenQueryParams(params);
  for (const key of params.keys()) {
    if (!allowed.has(key)) {
      throw new GatewayError(400, 'INVALID_INPUT', `Unexpected query parameter '${key}'.`);
    }
  }
}

function parsePagination(params: URLSearchParams): { page: number; pageSize: number } {
  const rawPage = params.get('page');
  const rawSize = params.get('page_size') ?? params.get('limit');

  let page = DEFAULT_PAGE;
  if (rawPage !== null && rawPage !== '') {
    if (!/^\d+$/.test(rawPage)) {
      throw new GatewayError(400, 'INVALID_INPUT', 'page must be a positive integer.');
    }
    page = Number(rawPage);
    if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) {
      throw new GatewayError(400, 'INVALID_INPUT', 'page must be between 1 and 10000.');
    }
  }

  let pageSize = DEFAULT_PAGE_SIZE;
  if (rawSize !== null && rawSize !== '') {
    if (!/^\d+$/.test(rawSize)) {
      throw new GatewayError(400, 'INVALID_INPUT', 'page_size must be a positive integer.');
    }
    pageSize = Number(rawSize);
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw new GatewayError(
        400,
        'INVALID_INPUT',
        `page_size must be between 1 and ${MAX_PAGE_SIZE}.`,
      );
    }
  }

  return { page, pageSize };
}

function parseIsoDateParam(raw: string | null, fieldName: string): string | undefined {
  if (raw === null || raw === '') {
    return undefined;
  }
  if (!DATE_REGEX.test(raw)) {
    throw new GatewayError(400, 'INVALID_INPUT', `${fieldName} must be YYYY-MM-DD.`);
  }
  const [y, m, d] = raw.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() + 1 !== m ||
    dt.getUTCDate() !== d
  ) {
    throw new GatewayError(400, 'INVALID_INPUT', `${fieldName} is not a valid calendar date.`);
  }
  return raw;
}

function parseDateRange(params: URLSearchParams): { startDate?: string; endDate?: string } {
  const startDate = parseIsoDateParam(params.get('start_date'), 'start_date');
  const endDate = parseIsoDateParam(params.get('end_date'), 'end_date');
  if (startDate && endDate && endDate < startDate) {
    throw new GatewayError(400, 'INVALID_INPUT', 'end_date must be on or after start_date.');
  }
  return { startDate, endDate };
}

function parseBooleanParam(raw: string | null, fieldName: string): boolean | undefined {
  if (raw === null || raw === '') {
    return undefined;
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new GatewayError(400, 'INVALID_INPUT', `${fieldName} must be 'true' or 'false'.`);
}

function parseEnumParam<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  fieldName: string,
): T | undefined {
  if (raw === null || raw === '') {
    return undefined;
  }
  if (!allowed.includes(raw as T)) {
    throw new GatewayError(400, 'INVALID_INPUT', `Invalid ${fieldName}.`);
  }
  return raw as T;
}

function parseSort<T extends string>(
  params: URLSearchParams,
  allowedFields: readonly T[],
  defaultField: T,
  defaultDir: SortDir = 'desc',
): { sortBy: T; sortDir: SortDir } {
  const rawBy = params.get('sort_by');
  const rawDir = params.get('sort_dir');

  let sortBy = defaultField;
  if (rawBy !== null && rawBy !== '') {
    if (!allowedFields.includes(rawBy as T)) {
      throw new GatewayError(400, 'INVALID_INPUT', `Invalid sort_by field '${rawBy}'.`);
    }
    sortBy = rawBy as T;
  }

  let sortDir = defaultDir;
  if (rawDir !== null && rawDir !== '') {
    const lower = rawDir.toLowerCase();
    if (lower !== 'asc' && lower !== 'desc') {
      throw new GatewayError(400, 'INVALID_INPUT', "sort_dir must be 'asc' or 'desc'.");
    }
    sortDir = lower;
  }

  return { sortBy, sortDir };
}

export function validateDashboardSummaryQuery(params: URLSearchParams): DashboardSummaryQuery {
  assertAllowedQueryParams(
    params,
    new Set(['page', 'page_size', 'limit', 'branch_id', 'start_date', 'end_date', 'sort_by', 'sort_dir']),
  );
  const { page, pageSize } = parsePagination(params);
  const { startDate, endDate } = parseDateRange(params);
  const rawBranch = params.get('branch_id');
  const branchId = rawBranch ? assertValidUuid(rawBranch, 'branch_id') : undefined;
  const { sortBy, sortDir } = parseSort(
    params,
    ['summary_date', 'total_employees', 'present_count', 'late_count'] as const,
    'summary_date',
    'desc',
  );
  return { page, pageSize, branchId, startDate, endDate, sortBy, sortDir };
}

export function validateEmployeeDirectoryQuery(params: URLSearchParams): EmployeeDirectoryQuery {
  assertAllowedQueryParams(
    params,
    new Set([
      'page',
      'page_size',
      'limit',
      'branch_id',
      'is_active',
      'employment_status',
      'search',
      'sort_by',
      'sort_dir',
    ]),
  );
  const { page, pageSize } = parsePagination(params);
  const rawBranch = params.get('branch_id');
  const branchId = rawBranch ? assertValidUuid(rawBranch, 'branch_id') : undefined;
  const isActive = parseBooleanParam(params.get('is_active'), 'is_active');
  const employmentStatus = parseEnumParam<EmploymentStatus>(
    params.get('employment_status'),
    EMPLOYMENT_STATUSES,
    'employment_status',
  );
  const rawSearch = params.get('search')?.trim();
  let search: string | undefined;
  if (rawSearch) {
    if (!SAFE_SEARCH_REGEX.test(rawSearch)) {
      throw new GatewayError(400, 'INVALID_INPUT', 'search contains invalid characters.');
    }
    search = rawSearch;
  }
  const { sortBy, sortDir } = parseSort(
    params,
    ['full_name', 'employee_code', 'join_date', 'created_at'] as const,
    'full_name',
    'asc',
  );
  return { page, pageSize, branchId, isActive, employmentStatus, search, sortBy, sortDir };
}

export function validateBranchEmployeesQuery(params: URLSearchParams): BranchEmployeesQuery {
  assertAllowedQueryParams(
    params,
    new Set([
      'page',
      'page_size',
      'limit',
      'employee_id',
      'department_id',
      'is_active',
      'employment_status',
      'sort_by',
      'sort_dir',
    ]),
  );
  const { page, pageSize } = parsePagination(params);
  const rawEmp = params.get('employee_id');
  const rawDept = params.get('department_id');
  const employeeId = rawEmp ? assertValidUuid(rawEmp, 'employee_id') : undefined;
  const departmentId = rawDept ? assertValidUuid(rawDept, 'department_id') : undefined;
  const isActive = parseBooleanParam(params.get('is_active'), 'is_active');
  const employmentStatus = parseEnumParam<EmploymentStatus>(
    params.get('employment_status'),
    EMPLOYMENT_STATUSES,
    'employment_status',
  );
  const { sortBy, sortDir } = parseSort(
    params,
    ['full_name', 'employee_code', 'join_date', 'created_at'] as const,
    'full_name',
    'asc',
  );
  return { page, pageSize, employeeId, departmentId, isActive, employmentStatus, sortBy, sortDir };
}

export function validateShiftsQuery(params: URLSearchParams): ShiftsQuery {
  assertAllowedQueryParams(params, new Set(['page', 'page_size', 'limit', 'is_active', 'sort_by', 'sort_dir']));
  const { page, pageSize } = parsePagination(params);
  const isActive = parseBooleanParam(params.get('is_active'), 'is_active');
  const { sortBy, sortDir } = parseSort(params, ['code', 'name', 'start_time'] as const, 'code', 'asc');
  return { page, pageSize, isActive, sortBy, sortDir };
}

export function validateSchedulesQuery(params: URLSearchParams): SchedulesQuery {
  assertAllowedQueryParams(
    params,
    new Set(['page', 'page_size', 'limit', 'employee_id', 'start_date', 'end_date', 'status', 'sort_by', 'sort_dir']),
  );
  const { page, pageSize } = parsePagination(params);
  const { startDate, endDate } = parseDateRange(params);
  const rawEmp = params.get('employee_id');
  const employeeId = rawEmp ? assertValidUuid(rawEmp, 'employee_id') : undefined;
  const status = parseEnumParam<ScheduleStatus>(params.get('status'), SCHEDULE_STATUSES, 'status');
  const { sortBy, sortDir } = parseSort(
    params,
    ['schedule_date', 'created_at'] as const,
    'schedule_date',
    'desc',
  );
  return { page, pageSize, employeeId, startDate, endDate, status, sortBy, sortDir };
}

export function validateAttendanceQuery(params: URLSearchParams): AttendanceQuery {
  assertAllowedQueryParams(
    params,
    new Set(['page', 'page_size', 'limit', 'employee_id', 'start_date', 'end_date', 'status', 'sort_by', 'sort_dir']),
  );
  const { page, pageSize } = parsePagination(params);
  const { startDate, endDate } = parseDateRange(params);
  const rawEmp = params.get('employee_id');
  const employeeId = rawEmp ? assertValidUuid(rawEmp, 'employee_id') : undefined;
  const status = parseEnumParam<AttendanceStatus>(params.get('status'), ATTENDANCE_STATUSES, 'status');
  const { sortBy, sortDir } = parseSort(
    params,
    ['attendance_date', 'check_in_time'] as const,
    'attendance_date',
    'desc',
  );
  return { page, pageSize, employeeId, startDate, endDate, status, sortBy, sortDir };
}

export function validateLeaveRequestsQuery(params: URLSearchParams): LeaveRequestsQuery {
  assertAllowedQueryParams(
    params,
    new Set([
      'page',
      'page_size',
      'limit',
      'employee_id',
      'start_date',
      'end_date',
      'status',
      'leave_type',
      'sort_by',
      'sort_dir',
    ]),
  );
  const { page, pageSize } = parsePagination(params);
  const { startDate, endDate } = parseDateRange(params);
  const rawEmp = params.get('employee_id');
  const employeeId = rawEmp ? assertValidUuid(rawEmp, 'employee_id') : undefined;
  const status = parseEnumParam<LeaveStatus>(params.get('status'), LEAVE_STATUSES, 'status');
  const leaveType = parseEnumParam<LeaveType>(params.get('leave_type'), LEAVE_TYPES, 'leave_type');
  const { sortBy, sortDir } = parseSort(
    params,
    ['submitted_at', 'start_date', 'created_at'] as const,
    'submitted_at',
    'desc',
  );
  return { page, pageSize, employeeId, startDate, endDate, status, leaveType, sortBy, sortDir };
}
