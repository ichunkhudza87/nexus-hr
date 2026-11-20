import { GatewayError } from '../errors/gateway-error.ts';
import type {
  AttendanceDailySummaryRecord,
  CentralUserProfile,
  DashboardSummaryQuery,
  EmployeeDirectoryQuery,
  EmployeeDirectoryRecord,
  PaginatedResult,
} from '../types/domain.ts';

export interface CentralDirectoryClient {
  getUserProfileWithBranch(userId: string): Promise<CentralUserProfile | null>;
  getDashboardSummary(query: DashboardSummaryQuery): Promise<PaginatedResult<AttendanceDailySummaryRecord>>;
  getEmployeeDirectory(query: EmployeeDirectoryQuery): Promise<PaginatedResult<EmployeeDirectoryRecord>>;
}

export interface HttpCentralClientOptions {
  centralSupabaseUrl: string;
  centralServiceRoleKey: string;
  requestTimeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class HttpCentralClient implements CentralDirectoryClient {
  private readonly baseUrl: string;
  private readonly serviceRoleKey: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: HttpCentralClientOptions) {
    this.baseUrl = options.centralSupabaseUrl.replace(/\/+$/, '');
    this.serviceRoleKey = options.centralServiceRoleKey;
    this.timeoutMs = options.requestTimeoutMs ?? 5000;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async getUserProfileWithBranch(userId: string): Promise<CentralUserProfile | null> {
    const url = new URL(`${this.baseUrl}/rest/v1/user_profiles`);
    url.searchParams.set('id', `eq.${userId}`);
    url.searchParams.set('select', 'id,email,role,branch_id,is_active,branch:branches(id,code,is_active)');

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
        throw new GatewayError(502, 'CENTRAL_LOOKUP_FAILED', `Central profile lookup failed (${res.status}).`);
      }

      let rows: unknown;
      try {
        rows = await res.json();
      } catch {
        throw new GatewayError(502, 'CENTRAL_INVALID_RESPONSE', 'Invalid JSON from Central identity store.');
      }
      if (!Array.isArray(rows)) {
        throw new GatewayError(502, 'CENTRAL_INVALID_RESPONSE', 'Unexpected payload shape from Central identity store.');
      }
      if (rows.length === 0) {
        return null;
      }
      if (rows.length > 1) {
        throw new GatewayError(500, 'IDENTITY_AMBIGUITY', 'Duplicate user profile records returned.');
      }
      return (rows[0] as CentralUserProfile | undefined) ?? null;
    } catch (err) {
      if (err instanceof GatewayError) {
        throw err;
      }
      if (err instanceof Error && err.name === 'AbortError') {
        throw new GatewayError(504, 'CENTRAL_TIMEOUT', 'Central identity lookup timed out.');
      }
      throw new GatewayError(503, 'CENTRAL_UNAVAILABLE', 'Unable to reach Central identity store.');
    } finally {
      clearTimeout(timer);
    }
  }

  async getDashboardSummary(
    query: DashboardSummaryQuery,
  ): Promise<PaginatedResult<AttendanceDailySummaryRecord>> {
    const url = new URL(`${this.baseUrl}/rest/v1/attendance_daily_summaries`);
    url.searchParams.set(
      'select',
      'id,branch_id,summary_date,total_employees,present_count,late_count,absent_count,leave_count,last_synced_at',
    );
    if (query.branchId) {
      url.searchParams.set('branch_id', `eq.${query.branchId}`);
    }
    if (query.startDate) {
      url.searchParams.append('summary_date', `gte.${query.startDate}`);
    }
    if (query.endDate) {
      url.searchParams.append('summary_date', `lte.${query.endDate}`);
    }
    url.searchParams.set('order', `${query.sortBy}.${query.sortDir}`);
    return this.fetchPaginatedRest<AttendanceDailySummaryRecord>(url, query.page, query.pageSize);
  }

  async getEmployeeDirectory(
    query: EmployeeDirectoryQuery,
  ): Promise<PaginatedResult<EmployeeDirectoryRecord>> {
    const url = new URL(`${this.baseUrl}/rest/v1/employee_directory`);
    url.searchParams.set(
      'select',
      'id,branch_id,employee_code,full_name,email,department_name,position_title,employment_status,join_date,is_active,last_synced_at',
    );
    if (query.branchId) {
      url.searchParams.set('branch_id', `eq.${query.branchId}`);
    }
    if (query.isActive !== undefined) {
      url.searchParams.set('is_active', `eq.${String(query.isActive)}`);
    }
    if (query.employmentStatus) {
      url.searchParams.set('employment_status', `eq.${query.employmentStatus}`);
    }
    if (query.search) {
      url.searchParams.set('or', `(full_name.ilike.*${query.search}*,employee_code.ilike.*${query.search}*)`);
    }
    url.searchParams.set('order', `${query.sortBy}.${query.sortDir}`);
    return this.fetchPaginatedRest<EmployeeDirectoryRecord>(url, query.page, query.pageSize);
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
        throw new GatewayError(502, 'CENTRAL_LOOKUP_FAILED', `Central read query failed (${res.status}).`);
      }

      let rows: unknown;
      try {
        rows = await res.json();
      } catch {
        throw new GatewayError(502, 'CENTRAL_INVALID_RESPONSE', 'Invalid JSON from Central store.');
      }
      if (!Array.isArray(rows)) {
        throw new GatewayError(502, 'CENTRAL_INVALID_RESPONSE', 'Unexpected payload shape from Central store.');
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
        throw new GatewayError(504, 'CENTRAL_TIMEOUT', 'Central read query timed out.');
      }
      throw new GatewayError(503, 'CENTRAL_UNAVAILABLE', 'Unable to reach Central database.');
    } finally {
      clearTimeout(timer);
    }
  }
}
