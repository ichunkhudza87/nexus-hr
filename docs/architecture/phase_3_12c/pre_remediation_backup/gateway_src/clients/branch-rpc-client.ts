import { GatewayError, mapPostgrestError } from '../errors/gateway-error.ts';
import type { PostgrestErrorPayload } from '../errors/gateway-error.ts';
import type {
  BranchEmployeeRecord,
  LeaveDecisionInput,
  LeaveRequestRecord,
  SignedActorEnvelope,
  SuperadminLeaveUpdateInput,
} from '../types/domain.ts';

export interface BranchAClient {
  getEmployeesByAuthId(userAuthId: string): Promise<BranchEmployeeRecord[]>;
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

      const rows = (await res.json()) as BranchEmployeeRecord[];
      return Array.isArray(rows) ? rows : [];
    } catch (err) {
      if (err instanceof GatewayError) {
        throw err;
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

    // Exact SQL parameter contract from PHASE_3_12A_REMEDIATION_V2_6.sql (lines 570-582)
    const rpcBody = {
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

    // Exact SQL parameter contract from PHASE_3_12A_REMEDIATION_V2_6.sql (lines 645-666)
    const rpcBody = {
      p_request_id: input.requestId,
      p_operation_mode: input.operationMode,
      p_employee_id: input.employeeId ?? null,
      p_leave_type: input.leaveType ?? null,
      p_start_date: input.startDate ?? null,
      p_end_date: input.endDate ?? null,
      p_total_days: input.totalDays ?? null,
      p_reason: input.reason ?? null,
      p_status: input.status ?? null,
      p_rejection_reason: input.rejectionReason ?? null,
      p_approved_by: input.approvedBy ?? null,
      p_approved_at: input.approvedAt ?? null,
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

      const data = (await res.json()) as T;
      return data;
    } catch (err) {
      if (err instanceof GatewayError) {
        throw err;
      }
      throw new GatewayError(503, 'BRANCH_RPC_UNAVAILABLE', 'Unable to execute Branch A RPC.');
    } finally {
      clearTimeout(timer);
    }
  }
}
