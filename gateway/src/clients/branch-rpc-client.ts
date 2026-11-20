import { GatewayError, mapPostgrestError } from '../errors/gateway-error.ts';
import type { PostgrestErrorPayload } from '../errors/gateway-error.ts';
import type {
  AttendanceQuery,
  AttendanceRecord,
  BranchEmployeeDetailRecord,
  BranchEmployeeRecord,
  BranchEmployeesQuery,
  EmployeeScheduleRecord,
  LeaveDecisionInput,
  LeaveRequestRecord,
  LeaveRequestsQuery,
  PaginatedResult,
  SchedulesQuery,
  ShiftRecord,
  ShiftsQuery,
  SignedActorEnvelope,
  SuperadminLeaveUpdateInput,
} from '../types/domain.ts';

export interface BranchAClient {
  getEmployeesByAuthId(userAuthId: string): Promise<BranchEmployeeRecord[]>;
  getEmployees(query: BranchEmployeesQuery): Promise<PaginatedResult<BranchEmployeeDetailRecord>>;
  getShifts(query: ShiftsQuery): Promise<PaginatedResult<ShiftRecord>>;
  getSchedules(query: SchedulesQuery): Promise<PaginatedResult<EmployeeScheduleRecord>>;
  getAttendance(query: AttendanceQuery): Promise<PaginatedResult<AttendanceRecord>>;
  getLeaveRequests(query: LeaveRequestsQuery): Promise<PaginatedResult<LeaveRequestRecord>>;
  decideLeaveRequest(
    input: LeaveDecisionInput,
    envelope: SignedActorEnvelope,
  ): Promise<LeaveRequestRecord>;
  superadminUpdateLeaveRequest(
    input: SuperadminLeaveUpdateInput,
    envelope: SignedActorEnvelope,
  ): Promise<LeaveRequestRecord>;
}

export interface HttpBranchAClientOptions {
  branchASupabaseUrl: string;
  branchAServiceRoleKey: string;
  requestTimeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class HttpBranchAClient implements BranchAClient {
  private readonly baseUrl: string;
  private readonly serviceRoleKey: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: HttpBranchAClientOptions) {
    this.baseUrl = options.branchASupabaseUrl.replace(/\/+$/, '');
    this.serviceRoleKey = options.branchAServiceRoleKey;
    this.timeoutMs = options.requestTimeoutMs ?? 5000;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async getEmployeesByAuthId(userAuthId: string): Promise<BranchEmployeeRecord[]> {
    const url = new URL(`${this.baseUrl}/rest/v1/employees`);
    url.searchParams.set('user_auth_id', `eq.${userAuthId}`);
    url.searchParams.set('is_deleted', 'eq.false');
    url.searchParams.set('select', 'id,user_auth_id,is_active,is_deleted');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchFn(url.toString(), {
        method: 'GET',
        headers: {
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${this.serviceRoleKey}`,
          accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new GatewayError(502, 'BRANCH_LOOKUP_FAILED', `Branch A employee lookup failed (${res.status}).`);
      }

      let rows: unknown;
      try {
        rows = await res.json();
      } catch {
        throw new GatewayError(502, 'BRANCH_INVALID_RESPONSE', 'Invalid JSON from Branch A employee lookup.');
      }
      return Array.isArray(rows) ? (rows as BranchEmployeeRecord[]) : [];
    } catch (err) {
      if (err instanceof GatewayError) {
        throw err;
      }
      if (err instanceof Error && err.name === 'AbortError') {
        throw new GatewayError(504, 'BRANCH_TIMEOUT', 'Branch A employee lookup timed out.');
      }
      throw new GatewayError(503, 'BRANCH_UNAVAILABLE', 'Unable to reach Branch A database.');
    } finally {
      clearTimeout(timer);
    }
  }

  async decideLeaveRequest(
    input: LeaveDecisionInput,
    envelope: SignedActorEnvelope,
  ): Promise<LeaveRequestRecord> {
    if (envelope.actionScope !== 'LEAVE_DECIDE' || envelope.operationMode !== 'DECISION') {
      throw new GatewayError(500, 'ENVELOPE_SCOPE_MISMATCH', 'Invalid actor envelope scope for leave decision.');
    }
    if (!envelope.keyId) {
      throw new GatewayError(500, 'SIGNING_KEY_MISSING', 'Signed envelope is missing keyId.');
    }

    // Exact SQL parameter contract matching SQL Remediation v2.7 rpc_branch_decide_leave_request
    const rpcBody = {
      p_key_id: envelope.keyId,
      p_request_id: input.requestId,
      p_decision: input.decision,
      p_rejection_reason: input.decision === 'REJECTED' ? input.rejectionReason : null,
      p_actor_user_id: envelope.actorUserId,
      p_actor_email: envelope.actorEmail,
      p_actor_role: envelope.actorRole,
      p_branch_id: envelope.branchId,
      p_employee_id: envelope.employeeId,
      p_exp: envelope.exp,
      p_nonce: envelope.nonce,
      p_actor_sig: envelope.actorSig,
    };

    return this.invokeRpc<LeaveRequestRecord>('rpc_branch_decide_leave_request', rpcBody);
  }

  async superadminUpdateLeaveRequest(
    input: SuperadminLeaveUpdateInput,
    envelope: SignedActorEnvelope,
  ): Promise<LeaveRequestRecord> {
    if (envelope.actionScope !== 'LEAVE_SUPERADMIN_UPDATE') {
      throw new GatewayError(500, 'ENVELOPE_SCOPE_MISMATCH', 'Invalid actor envelope scope for superadmin update.');
    }
    if (!envelope.keyId) {
      throw new GatewayError(500, 'SIGNING_KEY_MISSING', 'Signed envelope is missing keyId.');
    }

    const setRejectionReason = input.rejectionReason !== undefined;
    const setApprovedBy = input.approvedBy !== undefined;
    const setApprovedAt = input.approvedAt !== undefined;

    // Exact SQL parameter contract matching SQL Remediation v2.7 rpc_superadmin_update_leave_request
    const rpcBody = {
      p_key_id: envelope.keyId,
      p_request_id: input.requestId,
      p_operation_mode: input.operationMode,
      p_employee_id: input.employeeId ?? null,
      p_leave_type: input.leaveType ?? null,
      p_start_date: input.startDate ?? null,
      p_end_date: input.endDate ?? null,
      p_total_days: input.totalDays ?? null,
      p_reason: input.reason ?? null,
      p_status: input.status ?? null,
      p_rejection_reason: setRejectionReason ? input.rejectionReason : null,
      p_approved_by: setApprovedBy ? input.approvedBy : null,
      p_approved_at: setApprovedAt ? input.approvedAt : null,
      p_set_rejection_reason: setRejectionReason,
      p_set_approved_by: setApprovedBy,
      p_set_approved_at: setApprovedAt,
      p_actor_user_id: envelope.actorUserId,
      p_actor_email: envelope.actorEmail,
      p_actor_role: envelope.actorRole,
      p_branch_id: envelope.branchId,
      p_actor_employee_id: envelope.employeeId,
      p_exp: envelope.exp,
      p_nonce: envelope.nonce,
      p_actor_sig: envelope.actorSig,
    };

    return this.invokeRpc<LeaveRequestRecord>('rpc_superadmin_update_leave_request', rpcBody);
  }

  async getEmployees(
    query: BranchEmployeesQuery,
  ): Promise<PaginatedResult<BranchEmployeeDetailRecord>> {
    const url = new URL(`${this.baseUrl}/rest/v1/employees`);
    url.searchParams.set(
      'select',
      'id,employee_code,user_auth_id,department_id,position_id,full_name,email,phone_number,employment_status,join_date,resignation_date,is_active,is_deleted,created_at,updated_at',
    );
    url.searchParams.set('is_deleted', 'eq.false');
    if (query.employeeId) {
      url.searchParams.set('id', `eq.${query.employeeId}`);
    }
    if (query.departmentId) {
      url.searchParams.set('department_id', `eq.${query.departmentId}`);
    }
    if (query.isActive !== undefined) {
      url.searchParams.set('is_active', `eq.${String(query.isActive)}`);
    }
    if (query.employmentStatus) {
      url.searchParams.set('employment_status', `eq.${query.employmentStatus}`);
    }
    url.searchParams.set('order', `${query.sortBy}.${query.sortDir}`);
    return this.fetchPaginatedRest<BranchEmployeeDetailRecord>(url, query.page, query.pageSize);
  }

  async getShifts(query: ShiftsQuery): Promise<PaginatedResult<ShiftRecord>> {
    const url = new URL(`${this.baseUrl}/rest/v1/shifts`);
    url.searchParams.set(
      'select',
      'id,code,name,start_time,end_time,is_overnight,break_duration_mins,is_active',
    );
    if (query.isActive !== undefined) {
      url.searchParams.set('is_active', `eq.${String(query.isActive)}`);
    }
    url.searchParams.set('order', `${query.sortBy}.${query.sortDir}`);
    return this.fetchPaginatedRest<ShiftRecord>(url, query.page, query.pageSize);
  }

  async getSchedules(query: SchedulesQuery): Promise<PaginatedResult<EmployeeScheduleRecord>> {
    const url = new URL(`${this.baseUrl}/rest/v1/employee_schedules`);
    url.searchParams.set(
      'select',
      'id,employee_id,shift_id,schedule_date,status,notes,created_at,updated_at',
    );
    if (query.employeeId) {
      url.searchParams.set('employee_id', `eq.${query.employeeId}`);
    }
    if (query.startDate) {
      url.searchParams.append('schedule_date', `gte.${query.startDate}`);
    }
    if (query.endDate) {
      url.searchParams.append('schedule_date', `lte.${query.endDate}`);
    }
    if (query.status) {
      url.searchParams.set('status', `eq.${query.status}`);
    }
    url.searchParams.set('order', `${query.sortBy}.${query.sortDir}`);
    return this.fetchPaginatedRest<EmployeeScheduleRecord>(url, query.page, query.pageSize);
  }

  async getAttendance(query: AttendanceQuery): Promise<PaginatedResult<AttendanceRecord>> {
    const url = new URL(`${this.baseUrl}/rest/v1/attendance`);
    url.searchParams.set(
      'select',
      'id,schedule_id,employee_id,attendance_date,check_in_time,check_out_time,status,check_in_method,check_out_method,is_verified,created_at,updated_at',
    );
    if (query.employeeId) {
      url.searchParams.set('employee_id', `eq.${query.employeeId}`);
    }
    if (query.startDate) {
      url.searchParams.append('attendance_date', `gte.${query.startDate}`);
    }
    if (query.endDate) {
      url.searchParams.append('attendance_date', `lte.${query.endDate}`);
    }
    if (query.status) {
      url.searchParams.set('status', `eq.${query.status}`);
    }
    url.searchParams.set('order', `${query.sortBy}.${query.sortDir}`);
    return this.fetchPaginatedRest<AttendanceRecord>(url, query.page, query.pageSize);
  }

  async getLeaveRequests(
    query: LeaveRequestsQuery,
  ): Promise<PaginatedResult<LeaveRequestRecord>> {
    const url = new URL(`${this.baseUrl}/rest/v1/leave_requests`);
    url.searchParams.set(
      'select',
      'id,employee_id,leave_type,start_date,end_date,total_days,reason,status,submitted_at,approved_by,approved_at,rejection_reason,created_at,updated_at',
    );
    if (query.employeeId) {
      url.searchParams.set('employee_id', `eq.${query.employeeId}`);
    }
    if (query.startDate) {
      url.searchParams.set('start_date', `gte.${query.startDate}`);
    }
    if (query.endDate) {
      url.searchParams.set('end_date', `lte.${query.endDate}`);
    }
    if (query.status) {
      url.searchParams.set('status', `eq.${query.status}`);
    }
    if (query.leaveType) {
      url.searchParams.set('leave_type', `eq.${query.leaveType}`);
    }
    url.searchParams.set('order', `${query.sortBy}.${query.sortDir}`);
    return this.fetchPaginatedRest<LeaveRequestRecord>(url, query.page, query.pageSize);
  }

  private async fetchPaginatedRest<T>(
    url: URL,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<T>> {
    const offset = (page - 1) * pageSize;
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('offset', String(offset));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchFn(url.toString(), {
        method: 'GET',
        headers: {
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${this.serviceRoleKey}`,
          accept: 'application/json',
          prefer: 'count=exact',
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new GatewayError(502, 'BRANCH_LOOKUP_FAILED', `Branch A read query failed (${res.status}).`);
      }

      let rows: unknown;
      try {
        rows = await res.json();
      } catch {
        throw new GatewayError(502, 'BRANCH_INVALID_RESPONSE', 'Invalid JSON from Branch A store.');
      }
      if (!Array.isArray(rows)) {
        throw new GatewayError(502, 'BRANCH_INVALID_RESPONSE', 'Unexpected payload shape from Branch A store.');
      }

      const contentRange = res.headers.get('content-range');
      let totalCount: number | null = null;
      if (contentRange) {
        const slashIdx = contentRange.lastIndexOf('/');
        const totalStr = slashIdx >= 0 ? contentRange.slice(slashIdx + 1) : '';
        if (/^\d+$/.test(totalStr)) {
          totalCount = Number(totalStr);
        }
      }

      return { items: rows as T[], page, pageSize, totalCount };
    } catch (err) {
      if (err instanceof GatewayError) {
        throw err;
      }
      if (err instanceof Error && err.name === 'AbortError') {
        throw new GatewayError(504, 'BRANCH_TIMEOUT', 'Branch A read query timed out.');
      }
      throw new GatewayError(503, 'BRANCH_UNAVAILABLE', 'Unable to reach Branch A database.');
    } finally {
      clearTimeout(timer);
    }
  }

  private async invokeRpc<T>(rpcName: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}/rest/v1/rpc/${rpcName}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${this.serviceRoleKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        let errPayload: PostgrestErrorPayload | null = null;
        try {
          errPayload = (await res.json()) as PostgrestErrorPayload;
        } catch {
          errPayload = null;
        }
        throw mapPostgrestError(res.status, errPayload);
      }

      let data: T;
      try {
        data = (await res.json()) as T;
      } catch {
        throw new GatewayError(502, 'BRANCH_RPC_INVALID_RESPONSE', 'Invalid JSON payload returned by Branch A RPC.');
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new GatewayError(502, 'BRANCH_RPC_INVALID_RESPONSE', 'Unexpected RPC response shape from Branch A.');
      }
      return data;
    } catch (err) {
      if (err instanceof GatewayError) {
        throw err;
      }
      if (err instanceof Error && err.name === 'AbortError') {
        throw new GatewayError(504, 'BRANCH_RPC_TIMEOUT', 'Branch A RPC request timed out.');
      }
      throw new GatewayError(503, 'BRANCH_RPC_UNAVAILABLE', 'Unable to execute Branch A RPC.');
    } finally {
      clearTimeout(timer);
    }
  }
}
