export class GatewayError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'GatewayError';
    this.statusCode = statusCode;
    this.code = code;
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
 * without leaking internal schema names, stack traces, or credential hints.
 */
export function mapPostgrestError(
  httpStatus: number,
  payload: PostgrestErrorPayload | null,
): GatewayError {
  const pgCode = payload?.code ?? '';
  const msg = payload?.message ?? 'Database operation rejected.';

  if (pgCode === '42501' || httpStatus === 401 || httpStatus === 403) {
    return new GatewayError(403, 'FORBIDDEN', msg);
  }
  if (pgCode === 'P0002' || httpStatus === 404) {
    return new GatewayError(404, 'NOT_FOUND', msg);
  }
  if (pgCode === '23514' || pgCode === '22023' || pgCode === '22P02') {
    return new GatewayError(422, 'VALIDATION_ERROR', msg);
  }
  if (pgCode === '23505' || pgCode === '23503' || pgCode === 'P0001') {
    if (msg.includes('42501')) {
      return new GatewayError(403, 'FORBIDDEN', msg);
    }
    if (msg.includes('P0002')) {
      return new GatewayError(404, 'NOT_FOUND', msg);
    }
    return new GatewayError(409, 'BUSINESS_RULE_VIOLATION', msg);
  }
  if (pgCode === '55000') {
    return new GatewayError(503, 'GATEWAY_KEY_NOT_PROVISIONED', 'Security configuration unavailable.');
  }

  return new GatewayError(502, 'UPSTREAM_RPC_ERROR', 'Branch RPC request failed.');
}
