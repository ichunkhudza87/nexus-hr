import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extractBearerToken } from './auth/central-jwt.ts';
import type { CentralJwtVerifier } from './auth/central-jwt.ts';
import type { IdentityResolver } from './auth/identity-resolver.ts';
import type { BranchAClient } from './clients/branch-rpc-client.ts';
import type { CentralDirectoryClient } from './clients/central-client.ts';
import { GatewayError } from './errors/gateway-error.ts';
import type { ActorHmacSigner } from './security/hmac-signer.ts';
import type { Logger } from './security/log-sanitizer.ts';
import type { NonceStore } from './security/nonce-store.ts';
import type { LeaveService } from './services/leave-service.ts';
import { validateManagerDecisionInput, validateSuperadminUpdateInput } from './validation/leave-schemas.ts';
import {
  validateAttendanceQuery,
  validateBranchEmployeesQuery,
  validateDashboardSummaryQuery,
  validateEmployeeDirectoryQuery,
  validateLeaveRequestsQuery,
  validateSchedulesQuery,
  validateShiftsQuery,
} from './validation/read-schemas.ts';

const MAX_BODY_BYTES = 64 * 1024;
const MANAGER_DECIDE_ROUTE = /^\/api\/v1\/leave-requests\/([^/]+)\/decide$/;
const SUPERADMIN_UPDATE_ROUTE = /^\/api\/v1\/admin\/leave-requests\/([^/]+)$/;

export interface GatewayAppDeps {
  jwtVerifier: CentralJwtVerifier;
  identityResolver: IdentityResolver;
  leaveService: LeaveService;
  nonceStore: NonceStore;
  hmacSigner: ActorHmacSigner;
  branchAId: string;
  centralClient: CentralDirectoryClient;
  branchClient: BranchAClient;
  logger: Logger;
  corsAllowedOrigins?: string[];
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new GatewayError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.');
  }

  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new GatewayError(413, 'PAYLOAD_TOO_LARGE', 'Request payload exceeds limit.');
    }
    chunks.push(buf);
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) {
    throw new GatewayError(400, 'INVALID_INPUT', 'Empty JSON body.');
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GatewayError(400, 'INVALID_INPUT', 'Malformed JSON body.');
  }
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(JSON.stringify(body));
}

function applyCorsHeaders(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigins: string[] | undefined,
): boolean {
  const origin = req.headers.origin;
  if (!origin) {
    return false;
  }
  const isAllowed = Array.isArray(allowedOrigins) && allowedOrigins.includes(origin);
  if (isAllowed) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-credentials', 'true');
    res.setHeader(
      'access-control-allow-methods',
      'GET, POST, PATCH, OPTIONS',
    );
    res.setHeader(
      'access-control-allow-headers',
      'Authorization, Content-Type, X-Request-Nonce',
    );
    res.setHeader('access-control-max-age', '86400');
    res.setHeader('vary', 'Origin');
    return true;
  }
  return false;
}

export function createGatewayHandler(deps: GatewayAppDeps) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = (req.method ?? 'GET').toUpperCase();
    const urlObj = new URL(req.url ?? '/', 'http://localhost');
    const pathname = urlObj.pathname;
    const searchParams = urlObj.searchParams;

    try {
      const origin = req.headers.origin;
      if (origin) {
        const corsSet = applyCorsHeaders(req, res, deps.corsAllowedOrigins);
        if (!corsSet) {
          throw new GatewayError(403, 'CORS_FORBIDDEN', 'Origin not allowed by CORS policy.');
        }
      }

      if (method === 'OPTIONS') {
        res.statusCode = 204;
        res.setHeader('content-length', '0');
        res.end();
        return;
      }

      if (method === 'GET' && pathname === '/health') {
        sendJson(res, 200, {
          status: 'ok',
          service: 'nexus-hr-gateway',
          branchId: deps.branchAId,
          activeSigningKeyId: deps.hmacSigner.getActiveKeyId(),
        });
        return;
      }

      const decideMatch = method === 'POST' ? MANAGER_DECIDE_ROUTE.exec(pathname) : null;
      const adminMatch = method === 'PATCH' ? SUPERADMIN_UPDATE_ROUTE.exec(pathname) : null;
      const isReadRoute = method === 'GET' && (
        pathname === '/api/me' ||
        pathname === '/api/dashboard/summary' ||
        pathname === '/api/employees/directory' ||
        pathname === '/api/employees' ||
        pathname === '/api/shifts' ||
        pathname === '/api/schedules' ||
        pathname === '/api/attendance' ||
        pathname === '/api/leave-requests'
      );

      if (!decideMatch && !adminMatch && !isReadRoute) {
        throw new GatewayError(404, 'ROUTE_NOT_FOUND', 'Endpoint not found.');
      }

      // Authenticate bearer JWT first so unauthenticated traffic cannot pollute process-local NonceStore.
      const rawToken = extractBearerToken(req.headers.authorization);
      const claims = await deps.jwtVerifier.verifyToken(rawToken);

      // Optional single-process defense-in-depth client replay header (consumed atomically if provided).
      const reqNonceHeader = req.headers['x-request-nonce'];
      if (typeof reqNonceHeader === 'string' && reqNonceHeader.trim() !== '') {
        deps.nonceStore.consumeInboundNonce('req', reqNonceHeader, 300);
      }

      const actor = await deps.identityResolver.resolveActor(claims);

      if (decideMatch) {
        const body = await readJsonBody(req);
        const input = validateManagerDecisionInput(decideMatch[1], body);
        const result = await deps.leaveService.decideLeaveRequest(actor, input);
        sendJson(res, 200, { data: result });
        return;
      }

      if (adminMatch) {
        const body = await readJsonBody(req);
        const input = validateSuperadminUpdateInput(adminMatch[1], body);
        const result = await deps.leaveService.superadminUpdateLeaveRequest(actor, input);
        sendJson(res, 200, { data: result });
        return;
      }

      // ------------------------------------------------------------------------
      // READ ENDPOINTS (Role & Branch Authorized)
      // ------------------------------------------------------------------------
      if (pathname === '/api/me') {
        sendJson(res, 200, {
          data: {
            id: actor.actorUserId,
            email: actor.actorEmail,
            role: actor.actorRole,
            branchId: actor.branchId,
            employeeId: actor.employeeId,
          },
        });
        return;
      }

      if (pathname === '/api/dashboard/summary') {
        const query = validateDashboardSummaryQuery(searchParams);
        if (actor.actorRole !== 'SUPERADMIN' && actor.actorRole !== 'CENTRAL_HR') {
          query.branchId = deps.branchAId;
        }
        const data = await deps.centralClient.getDashboardSummary(query);
        sendJson(res, 200, { data });
        return;
      }

      if (pathname === '/api/employees/directory') {
        const query = validateEmployeeDirectoryQuery(searchParams);
        if (actor.actorRole !== 'SUPERADMIN' && actor.actorRole !== 'CENTRAL_HR') {
          query.branchId = deps.branchAId;
        }
        const data = await deps.centralClient.getEmployeeDirectory(query);
        sendJson(res, 200, { data });
        return;
      }

      if (pathname === '/api/employees') {
        const query = validateBranchEmployeesQuery(searchParams);
        if (actor.actorRole === 'EMPLOYEE') {
          query.employeeId = actor.employeeId ?? undefined;
        }
        const data = await deps.branchClient.getEmployees(query);
        sendJson(res, 200, { data });
        return;
      }

      if (pathname === '/api/shifts') {
        const query = validateShiftsQuery(searchParams);
        const data = await deps.branchClient.getShifts(query);
        sendJson(res, 200, { data });
        return;
      }

      if (pathname === '/api/schedules') {
        const query = validateSchedulesQuery(searchParams);
        if (actor.actorRole === 'EMPLOYEE') {
          query.employeeId = actor.employeeId ?? undefined;
        }
        const data = await deps.branchClient.getSchedules(query);
        sendJson(res, 200, { data });
        return;
      }

      if (pathname === '/api/attendance') {
        const query = validateAttendanceQuery(searchParams);
        if (actor.actorRole === 'EMPLOYEE') {
          query.employeeId = actor.employeeId ?? undefined;
        }
        const data = await deps.branchClient.getAttendance(query);
        sendJson(res, 200, { data });
        return;
      }

      if (pathname === '/api/leave-requests') {
        const query = validateLeaveRequestsQuery(searchParams);
        if (actor.actorRole === 'EMPLOYEE') {
          query.employeeId = actor.employeeId ?? undefined;
        }
        const data = await deps.branchClient.getLeaveRequests(query);
        sendJson(res, 200, { data });
        return;
      }
    } catch (err) {
      if (err instanceof GatewayError) {
        deps.logger.warn('gateway.request.rejected', {
          method,
          pathname,
          statusCode: err.statusCode,
          code: err.code,
          message: err.message,
          internalDetail: err.internalDetail,
        });
        sendJson(res, err.statusCode, {
          error: {
            code: err.code,
            message: err.message,
          },
        });
        return;
      }

      deps.logger.error('gateway.request.unexpected_error', {
        method,
        pathname,
        error: err,
      });
      sendJson(res, 500, {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An internal gateway error occurred.',
        },
      });
    }
  };
}

export function createGatewayServer(deps: GatewayAppDeps): http.Server {
  return http.createServer(createGatewayHandler(deps));
}
