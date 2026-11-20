export class GatewayError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly internalDetail?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    internalDetail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'GatewayError';
    this.statusCode = statusCode;
    this.code = code;
    this.internalDetail = internalDetail;
  }
}

export interface PostgrestErrorPayload {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * Translates PostgreSQL / PostgREST RPC errors into safe client-facing HTTP errors
 * without leaking internal schema names, constraint names, stack traces, or credentials.
 * Internal diagnostics are attached to internalDetail for sanitized server-side logging only.
 */
export function mapPostgrestError(
  httpStatus: number,
  payload: PostgrestErrorPayload | null,
): GatewayError {
  const pgCode = payload?.code ?? '';
  const msg = payload?.message ?? 'Database operation rejected.';
  const internalDetail = {
    pgCode: pgCode || undefined,
    httpStatus,
    pgMessage: payload?.message,
    pgDetails: payload?.details ?? undefined,
    pgHint: payload?.hint ?? undefined,
  };

  if (pgCode === '42501' || httpStatus === 401 || httpStatus === 403) {
    return new GatewayError(403, 'FORBIDDEN', msg, internalDetail);
  }
  if (pgCode === 'P0002' || httpStatus === 404) {
    return new GatewayError(404, 'NOT_FOUND', msg, internalDetail);
  }
  if (pgCode === '23514' || pgCode === '22023' || pgCode === '22P02') {
    return new GatewayError(422, 'VALIDATION_ERROR', msg, internalDetail);
  }
  if (pgCode === '23505') {
    return new GatewayError(
      409,
      'BUSINESS_RULE_VIOLATION',
      'A conflicting record already exists.',
      internalDetail,
    );
  }
  if (pgCode === '23503') {
    return new GatewayError(
      409,
      'BUSINESS_RULE_VIOLATION',
      'Referenced record does not exist or cannot be linked.',
      internalDetail,
    );
  }
  if (pgCode === 'P0001') {
    if (msg.includes('42501')) {
      return new GatewayError(403, 'FORBIDDEN', 'Operation forbidden by security policy.', internalDetail);
    }
    if (msg.includes('P0002')) {
      return new GatewayError(404, 'NOT_FOUND', 'Requested record was not found.', internalDetail);
    }
    return new GatewayError(409, 'BUSINESS_RULE_VIOLATION', msg, internalDetail);
  }
  if (pgCode === '55000') {
    return new GatewayError(503, 'GATEWAY_KEY_NOT_PROVISIONED', 'Security configuration unavailable.', internalDetail);
  }

  return new GatewayError(502, 'UPSTREAM_RPC_ERROR', 'Branch RPC request failed.', internalDetail);
}
