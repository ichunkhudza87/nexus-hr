import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extractBearerToken } from './auth/central-jwt.ts';
import type { CentralJwtVerifier } from './auth/central-jwt.ts';
import type { IdentityResolver } from './auth/identity-resolver.ts';
import { GatewayError } from './errors/gateway-error.ts';
import type { ActorHmacSigner } from './security/hmac-signer.ts';
import type { Logger } from './security/log-sanitizer.ts';
import type { NonceStore } from './security/nonce-store.ts';
import type { LeaveService } from './services/leave-service.ts';
import { validateManagerDecisionInput, validateSuperadminUpdateInput } from './validation/leave-schemas.ts';

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
  logger: Logger;
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

export function createGatewayHandler(deps: GatewayAppDeps) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = (req.method ?? 'GET').toUpperCase();
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

    try {
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

      if (!decideMatch && !adminMatch) {
        throw new GatewayError(404, 'ROUTE_NOT_FOUND', 'Endpoint not found.');
      }

      // Optional client replay defense header (consumed atomically if provided)
      const reqNonceHeader = req.headers['x-request-nonce'];
      if (typeof reqNonceHeader === 'string' && reqNonceHeader.trim() !== '') {
        deps.nonceStore.consumeInboundNonce('req', reqNonceHeader, 300);
      }

      const rawToken = extractBearerToken(req.headers.authorization);
      const claims = await deps.jwtVerifier.verifyToken(rawToken);
      if (claims.jti) {
        // Optional defense against JWT jti replay if IdP emits single-use jtis for sensitive writes:
        // Note: Standard access tokens share one jti across a session, so only enforce req nonce for idempotent single-use.
      }

      const actor = await deps.identityResolver.resolveActor(claims);
      const body = await readJsonBody(req);

      if (decideMatch) {
        const input = validateManagerDecisionInput(decideMatch[1], body);
        const result = await deps.leaveService.decideLeaveRequest(actor, input);
        sendJson(res, 200, { data: result });
        return;
      }

      if (adminMatch) {
        const input = validateSuperadminUpdateInput(adminMatch[1], body);
        const result = await deps.leaveService.superadminUpdateLeaveRequest(actor, input);
        sendJson(res, 200, { data: result });
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
