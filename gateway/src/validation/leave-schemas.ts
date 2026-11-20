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
  'p_key_id',
  'p_actor_user_id',
  'p_actor_email',
  'p_actor_role',
  'p_actor_employee_id',
  'p_actor_sig',
  'p_branch_id',
  'p_nonce',
  'p_exp',
  'p_set_rejection_reason',
  'p_set_approved_by',
  'p_set_approved_at',
]);

function assertValidIsoDate(raw: unknown, fieldName: string): string {
  if (typeof raw !== 'string' || !DATE_REGEX.test(raw)) {
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

  if (Object.hasOwn(body, 'employee_id') && body.employee_id !== undefined) {
    if (body.employee_id === null) {
      throw new GatewayError(400, 'INVALID_INPUT', 'employee_id cannot be null.');
    }
    out.employeeId = assertValidUuid(body.employee_id, 'employee_id');
  }
  if (Object.hasOwn(body, 'leave_type') && body.leave_type !== undefined) {
    if (body.leave_type === null) {
      throw new GatewayError(400, 'INVALID_INPUT', 'leave_type cannot be null.');
    }
    if (typeof body.leave_type !== 'string' || !LEAVE_TYPES.includes(body.leave_type as LeaveType)) {
      throw new GatewayError(400, 'INVALID_INPUT', 'Invalid leave_type.');
    }
    out.leaveType = body.leave_type as LeaveType;
  }
  if (Object.hasOwn(body, 'start_date') && body.start_date !== undefined) {
    if (body.start_date === null) {
      throw new GatewayError(400, 'INVALID_INPUT', 'start_date cannot be null.');
    }
    out.startDate = assertValidIsoDate(body.start_date, 'start_date');
  }
  if (Object.hasOwn(body, 'end_date') && body.end_date !== undefined) {
    if (body.end_date === null) {
      throw new GatewayError(400, 'INVALID_INPUT', 'end_date cannot be null.');
    }
    out.endDate = assertValidIsoDate(body.end_date, 'end_date');
  }
  if (out.startDate && out.endDate && out.endDate < out.startDate) {
    throw new GatewayError(400, 'INVALID_INPUT', 'end_date must be on or after start_date.');
  }
  if (Object.hasOwn(body, 'total_days') && body.total_days !== undefined) {
    if (body.total_days === null) {
      throw new GatewayError(400, 'INVALID_INPUT', 'total_days cannot be null.');
    }
    if (typeof body.total_days !== 'number' || !Number.isFinite(body.total_days) || body.total_days <= 0) {
      throw new GatewayError(400, 'INVALID_INPUT', 'total_days must be a positive number.');
    }
    out.totalDays = body.total_days;
  }
  if (Object.hasOwn(body, 'reason') && body.reason !== undefined) {
    if (body.reason === null) {
      throw new GatewayError(400, 'INVALID_INPUT', 'reason cannot be null.');
    }
    if (typeof body.reason !== 'string' || body.reason.trim() === '') {
      throw new GatewayError(400, 'INVALID_INPUT', 'reason must be a non-empty string.');
    }
    out.reason = body.reason.trim();
  }
  if (Object.hasOwn(body, 'status') && body.status !== undefined) {
    if (body.status === null) {
      throw new GatewayError(400, 'INVALID_INPUT', 'status cannot be null.');
    }
    if (typeof body.status !== 'string' || !LEAVE_STATUSES.includes(body.status as LeaveStatus)) {
      throw new GatewayError(400, 'INVALID_INPUT', 'Invalid status.');
    }
    out.status = body.status as LeaveStatus;
  }
  if (Object.hasOwn(body, 'rejection_reason') && body.rejection_reason !== undefined) {
    if (body.rejection_reason === null) {
      out.rejectionReason = null;
    } else if (typeof body.rejection_reason !== 'string') {
      throw new GatewayError(400, 'INVALID_INPUT', 'rejection_reason must be string or null.');
    } else {
      const trimmed = body.rejection_reason.trim();
      if (trimmed === '') {
        throw new GatewayError(400, 'INVALID_INPUT', 'rejection_reason cannot be blank; pass null to clear.');
      }
      out.rejectionReason = trimmed;
    }
  }
  if (Object.hasOwn(body, 'approved_by') && body.approved_by !== undefined) {
    out.approvedBy = body.approved_by === null ? null : assertValidUuid(body.approved_by, 'approved_by');
  }
  if (Object.hasOwn(body, 'approved_at') && body.approved_at !== undefined) {
    if (body.approved_at !== null) {
      if (typeof body.approved_at !== 'string' || Number.isNaN(Date.parse(body.approved_at))) {
        throw new GatewayError(400, 'INVALID_INPUT', 'approved_at must be a valid ISO timestamp or null.');
      }
      out.approvedAt = body.approved_at;
    } else {
      out.approvedAt = null;
    }
  }

  if (opMode === 'DECISION') {
    if (out.status !== 'APPROVED' && out.status !== 'REJECTED') {
      throw new GatewayError(400, 'INVALID_INPUT', "DECISION mode requires status 'APPROVED' or 'REJECTED'.");
    }
    if (out.status === 'REJECTED' && (!out.rejectionReason || out.rejectionReason === '')) {
      throw new GatewayError(400, 'INVALID_INPUT', 'rejection_reason is mandatory when deciding REJECTED.');
    }
    if (out.status === 'APPROVED' && out.rejectionReason !== undefined && out.rejectionReason !== null) {
      throw new GatewayError(400, 'INVALID_INPUT', 'rejection_reason must be omitted or null when APPROVED.');
    }
    if (out.approvedBy === null || out.approvedAt === null) {
      throw new GatewayError(400, 'INVALID_INPUT', 'approved_by and approved_at cannot be null in DECISION mode.');
    }
  } else {
    const hasMutableField =
      out.employeeId !== undefined ||
      out.leaveType !== undefined ||
      out.startDate !== undefined ||
      out.endDate !== undefined ||
      out.totalDays !== undefined ||
      out.reason !== undefined ||
      out.status !== undefined ||
      out.rejectionReason !== undefined ||
      out.approvedBy !== undefined ||
      out.approvedAt !== undefined;
    if (!hasMutableField) {
      throw new GatewayError(400, 'INVALID_INPUT', 'CORRECTION mode requires at least one field to update.');
    }
    if (out.status === 'REJECTED' && out.rejectionReason === null) {
      throw new GatewayError(400, 'INVALID_INPUT', 'rejection_reason cannot be cleared to null when status is REJECTED.');
    }
  }

  return out;
}
