import { GatewayError } from '../errors/gateway-error.ts';
import { LEAVE_STATUSES, LEAVE_TYPES } from '../types/domain.ts';
import type {
  LeaveDecisionInput,
  LeaveStatus,
  LeaveType,
  OperationMode,
  SuperadminLeaveUpdateInput,
} from '../types/domain.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Keys clients are NEVER allowed to submit as actor or authority claims
const FORBIDDEN_ACTOR_KEYS = new Set([
  'actor_id',
  'actor_user_id',
  'actor_email',
  'actor_role',
  'actor_sig',
  'actor_employee_id',
  'employee_id_actor',
  'branch_id',
  'branch_code',
  'user_role',
  'p_actor_user_id',
  'p_actor_role',
  'p_actor_sig',
  'p_nonce',
  'p_exp',
]);

const FORBIDDEN_MANAGER_EXTRA_KEYS = new Set([
  'employee_id',
  'leave_type',
  'start_date',
  'end_date',
  'total_days',
  'reason',
  'status',
  'approved_by',
  'approved_at',
  'submitted_at',
]);

export function assertValidUuid(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !UUID_REGEX.test(value.trim())) {
    throw new GatewayError(400, 'INVALID_INPUT', `${fieldName} must be a valid UUID.`);
  }
  return value.trim().toLowerCase();
}

function assertObjectBody(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new GatewayError(400, 'INVALID_INPUT', 'Request body must be a JSON object.');
  }
  return raw as Record<string, unknown>;
}

function rejectForbiddenKeys(body: Record<string, unknown>, extraForbidden?: Set<string>): void {
  for (const key of Object.keys(body)) {
    const normalized = key.toLowerCase();
    if (FORBIDDEN_ACTOR_KEYS.has(normalized) || extraForbidden?.has(normalized)) {
      throw new GatewayError(
        400,
        'FORBIDDEN_IDENTITY_FIELD',
        `Client-supplied field '${key}' is not permitted.`,
      );
    }
  }
}

export function validateManagerDecisionInput(requestIdRaw: unknown, rawBody: unknown): LeaveDecisionInput {
  const requestId = assertValidUuid(requestIdRaw, 'request_id');
  const body = assertObjectBody(rawBody);
  rejectForbiddenKeys(body, FORBIDDEN_MANAGER_EXTRA_KEYS);

  const allowedKeys = new Set(['decision', 'rejection_reason']);
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) {
      throw new GatewayError(400, 'INVALID_INPUT', `Unexpected field '${key}'.`);
    }
  }

  const decision = body.decision;
  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    throw new GatewayError(400, 'INVALID_INPUT', "decision must be 'APPROVED' or 'REJECTED'.");
  }

  let rejectionReason: string | null = null;
  if (decision === 'REJECTED') {
    if (typeof body.rejection_reason !== 'string' || body.rejection_reason.trim() === '') {
      throw new GatewayError(400, 'INVALID_INPUT', 'rejection_reason is required when decision is REJECTED.');
    }
    rejectionReason = body.rejection_reason.trim();
  } else if (body.rejection_reason !== undefined && body.rejection_reason !== null) {
    throw new GatewayError(400, 'INVALID_INPUT', 'rejection_reason must be omitted or null when APPROVED.');
  }

  return {
    requestId,
    decision,
    rejectionReason,
  };
}

export function validateSuperadminUpdateInput(
  requestIdRaw: unknown,
  rawBody: unknown,
): SuperadminLeaveUpdateInput {
  const requestId = assertValidUuid(requestIdRaw, 'request_id');
  const body = assertObjectBody(rawBody);
  rejectForbiddenKeys(body);

  const allowedKeys = new Set([
    'operation_mode',
    'employee_id',
    'leave_type',
    'start_date',
    'end_date',
    'total_days',
    'reason',
    'status',
    'rejection_reason',
    'approved_by',
    'approved_at',
  ]);
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) {
      throw new GatewayError(400, 'INVALID_INPUT', `Unexpected field '${key}'.`);
    }
  }

  const opMode = body.operation_mode;
  if (opMode !== 'DECISION' && opMode !== 'CORRECTION') {
    throw new GatewayError(400, 'INVALID_INPUT', "operation_mode must be 'DECISION' or 'CORRECTION'.");
  }

  const out: SuperadminLeaveUpdateInput = {
    requestId,
    operationMode: opMode as OperationMode,
  };

  if (body.employee_id !== undefined && body.employee_id !== null) {
    out.employeeId = assertValidUuid(body.employee_id, 'employee_id');
  }
  if (body.leave_type !== undefined && body.leave_type !== null) {
    if (typeof body.leave_type !== 'string' || !LEAVE_TYPES.includes(body.leave_type as LeaveType)) {
      throw new GatewayError(400, 'INVALID_INPUT', 'Invalid leave_type.');
    }
    out.leaveType = body.leave_type as LeaveType;
  }
  if (body.start_date !== undefined && body.start_date !== null) {
    if (typeof body.start_date !== 'string' || !DATE_REGEX.test(body.start_date)) {
      throw new GatewayError(400, 'INVALID_INPUT', 'start_date must be YYYY-MM-DD.');
    }
    out.startDate = body.start_date;
  }
  if (body.end_date !== undefined && body.end_date !== null) {
    if (typeof body.end_date !== 'string' || !DATE_REGEX.test(body.end_date)) {
      throw new GatewayError(400, 'INVALID_INPUT', 'end_date must be YYYY-MM-DD.');
    }
    out.endDate = body.end_date;
  }
  if (body.total_days !== undefined && body.total_days !== null) {
    if (typeof body.total_days !== 'number' || !Number.isFinite(body.total_days) || body.total_days <= 0) {
      throw new GatewayError(400, 'INVALID_INPUT', 'total_days must be a positive number.');
    }
    out.totalDays = body.total_days;
  }
  if (body.reason !== undefined && body.reason !== null) {
    if (typeof body.reason !== 'string' || body.reason.trim() === '') {
      throw new GatewayError(400, 'INVALID_INPUT', 'reason must be a non-empty string.');
    }
    out.reason = body.reason.trim();
  }
  if (body.status !== undefined && body.status !== null) {
    if (typeof body.status !== 'string' || !LEAVE_STATUSES.includes(body.status as LeaveStatus)) {
      throw new GatewayError(400, 'INVALID_INPUT', 'Invalid status.');
    }
    out.status = body.status as LeaveStatus;
  }
  if (body.rejection_reason !== undefined) {
    if (body.rejection_reason !== null && typeof body.rejection_reason !== 'string') {
      throw new GatewayError(400, 'INVALID_INPUT', 'rejection_reason must be string or null.');
    }
    out.rejectionReason = body.rejection_reason === null ? null : body.rejection_reason.trim();
  }
  if (body.approved_by !== undefined) {
    out.approvedBy = body.approved_by === null ? null : assertValidUuid(body.approved_by, 'approved_by');
  }
  if (body.approved_at !== undefined) {
    if (body.approved_at !== null) {
      if (typeof body.approved_at !== 'string' || Number.isNaN(Date.parse(body.approved_at))) {
        throw new GatewayError(400, 'INVALID_INPUT', 'approved_at must be a valid ISO timestamp or null.');
      }
      out.approvedAt = body.approved_at;
    } else {
      out.approvedAt = null;
    }
  }

  if (opMode === 'DECISION' && out.status !== 'APPROVED' && out.status !== 'REJECTED') {
    throw new GatewayError(400, 'INVALID_INPUT', "DECISION mode requires status 'APPROVED' or 'REJECTED'.");
  }
  if (out.status === 'REJECTED' && (!out.rejectionReason || out.rejectionReason === '')) {
    throw new GatewayError(400, 'INVALID_INPUT', 'rejection_reason is mandatory when status is REJECTED.');
  }

  return out;
}
