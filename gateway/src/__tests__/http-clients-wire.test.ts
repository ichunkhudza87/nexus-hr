import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { HttpBranchAClient } from '../clients/branch-rpc-client.ts';
import { HttpCentralClient } from '../clients/central-client.ts';
import { GatewayError, mapPostgrestError } from '../errors/gateway-error.ts';
import { sanitizeForLog } from '../security/log-sanitizer.ts';
import type { LeaveRequestRecord, SignedActorEnvelope } from '../types/domain.ts';

interface CapturedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: http.IncomingHttpHeaders;
  bodyText: string;
  bodyJson: Record<string, unknown> | null;
}

function makeEnvelope(overrides: Partial<SignedActorEnvelope> = {}): SignedActorEnvelope {
  return {
    keyId: 'gw-hmac-v2',
    actionScope: 'LEAVE_DECIDE',
    targetId: '99999999-9999-4999-8999-999999999999',
    operationMode: 'DECISION',
    actorUserId: '11111111-1111-4111-8111-111111111111',
    actorEmail: 'mgr@nexus.local',
    actorRole: 'BRANCH_MANAGER',
    branchId: '00000000-0000-0000-0000-000000000001',
    employeeId: '22222222-2222-4222-8222-222222222222',
    exp: Math.floor(Date.now() / 1000) + 60,
    nonce: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    actorSig: 'a'.repeat(64),
    ...overrides,
  };
}

function makeLeaveRecord(overrides: Partial<LeaveRequestRecord> = {}): LeaveRequestRecord {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    employee_id: '44444444-4444-4444-8444-444444444444',
    leave_type: 'ANNUAL',
    start_date: '2026-12-01',
    end_date: '2026-12-02',
    total_days: 2,
    reason: 'Family event',
    status: 'APPROVED',
    submitted_at: '2026-11-11T00:00:00Z',
    approved_by: '11111111-1111-4111-8111-111111111111',
    approved_at: '2026-11-11T10:00:00Z',
    rejection_reason: null,
    created_at: '2026-11-11T00:00:00Z',
    updated_at: '2026-11-11T10:00:00Z',
    ...overrides,
  };
}

async function withLocalHttpServer(
  handler: (req: CapturedRequest, res: http.ServerResponse) => Promise<void> | void,
  fn: (ctx: { baseUrl: string; requests: CapturedRequest[] }) => Promise<void>,
): Promise<void> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const bodyText = Buffer.concat(chunks).toString('utf8');
    let bodyJson: Record<string, unknown> | null = null;
    if (bodyText) {
      try {
        bodyJson = JSON.parse(bodyText) as Record<string, unknown>;
      } catch {
        bodyJson = null;
      }
    }
    const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
    const captured: CapturedRequest = {
      method: req.method ?? 'GET',
      path: parsed.pathname,
      query: Object.fromEntries(parsed.searchParams.entries()),
      headers: req.headers,
      bodyText,
      bodyJson,
    };
    requests.push(captured);
    await handler(captured, res);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    await fn({ baseUrl, requests });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

describe('HTTP Clients Wire-Level Tests (Local Mock HTTP Server Only)', () => {
  const TEST_SRV_KEY = 'test_service_role_key_not_real_secret_value_0123456789';

  it('HttpCentralClient sends expected REST URL, query filters, and service_role auth headers', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    await withLocalHttpServer(
      async (_req, res) => {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify([
            {
              id: userId,
              email: 'mgr@nexus.local',
              role: 'BRANCH_MANAGER',
              branch_id: '00000000-0000-0000-0000-000000000001',
              is_active: true,
              branch: { id: '00000000-0000-0000-0000-000000000001', code: 'BRANCH-A', is_active: true },
            },
          ]),
        );
      },
      async ({ baseUrl, requests }) => {
        const client = new HttpCentralClient({
          centralSupabaseUrl: baseUrl,
          centralServiceRoleKey: TEST_SRV_KEY,
        });
        const profile = await client.getUserProfileWithBranch(userId);
        assert.equal(profile?.id, userId);
        assert.equal(requests.length, 1);
        const captured = requests[0]!;
        assert.equal(captured.method, 'GET');
        assert.equal(captured.path, '/rest/v1/user_profiles');
        assert.equal(captured.query.id, `eq.${userId}`);
        assert.equal(captured.query.select, 'id,email,role,branch_id,is_active,branch:branches(id,code,is_active)');
        assert.equal(captured.headers.apikey, TEST_SRV_KEY);
        assert.equal(captured.headers.authorization, `Bearer ${TEST_SRV_KEY}`);
      },
    );
  });

  it('HttpBranchAClient serializes p_key_id and exact RPC contract for decideLeaveRequest', async () => {
    await withLocalHttpServer(
      async (_req, res) => {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(makeLeaveRecord({ status: 'REJECTED', rejection_reason: 'Peak blackouts' })));
      },
      async ({ baseUrl, requests }) => {
        const client = new HttpBranchAClient({
          branchASupabaseUrl: baseUrl,
          branchAServiceRoleKey: TEST_SRV_KEY,
        });
        const envelope = makeEnvelope({ keyId: 'gw-hmac-v2' });
        const result = await client.decideLeaveRequest(
          {
            requestId: envelope.targetId,
            decision: 'REJECTED',
            rejectionReason: 'Peak blackouts',
          },
          envelope,
        );

        assert.equal(result.status, 'REJECTED');
        assert.equal(requests.length, 1);
        const captured = requests[0]!;
        assert.equal(captured.method, 'POST');
        assert.equal(captured.path, '/rest/v1/rpc/rpc_branch_decide_leave_request');
        assert.equal(captured.headers.apikey, TEST_SRV_KEY);
        assert.equal(captured.headers.authorization, `Bearer ${TEST_SRV_KEY}`);
        assert.deepEqual(captured.bodyJson, {
          p_key_id: 'gw-hmac-v2',
          p_request_id: envelope.targetId,
          p_decision: 'REJECTED',
          p_rejection_reason: 'Peak blackouts',
          p_actor_user_id: envelope.actorUserId,
          p_actor_email: envelope.actorEmail,
          p_actor_role: envelope.actorRole,
          p_branch_id: envelope.branchId,
          p_employee_id: envelope.employeeId,
          p_exp: envelope.exp,
          p_nonce: envelope.nonce,
          p_actor_sig: envelope.actorSig,
        });
      },
    );
  });

  it('HttpBranchAClient distinguishes omitted vs explicit null CORRECTION fields on wire (B-2)', async () => {
    await withLocalHttpServer(
      async (_req, res) => {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(makeLeaveRecord({ total_days: 3 })));
      },
      async ({ baseUrl, requests }) => {
        const client = new HttpBranchAClient({
          branchASupabaseUrl: baseUrl,
          branchAServiceRoleKey: TEST_SRV_KEY,
        });
        const saEnvelope = makeEnvelope({
          keyId: 'gw-hmac-v2',
          actionScope: 'LEAVE_SUPERADMIN_UPDATE',
          operationMode: 'CORRECTION',
          actorRole: 'SUPERADMIN',
          branchId: null,
          employeeId: null,
        });

        // 1. Omitted nullable fields (must transmit p_set_* = false)
        await client.superadminUpdateLeaveRequest(
          {
            requestId: saEnvelope.targetId,
            operationMode: 'CORRECTION',
            totalDays: 3,
          },
          saEnvelope,
        );
        const firstBody = requests[0]!.bodyJson!;
        assert.equal(firstBody.p_key_id, 'gw-hmac-v2');
        assert.equal(firstBody.p_total_days, 3);
        assert.equal(firstBody.p_rejection_reason, null);
        assert.equal(firstBody.p_approved_by, null);
        assert.equal(firstBody.p_approved_at, null);
        assert.equal(firstBody.p_set_rejection_reason, false);
        assert.equal(firstBody.p_set_approved_by, false);
        assert.equal(firstBody.p_set_approved_at, false);

        // 2. Explicit null on rejection_reason & approved_at while leaving approved_by omitted
        await client.superadminUpdateLeaveRequest(
          {
            requestId: saEnvelope.targetId,
            operationMode: 'CORRECTION',
            status: 'PENDING',
            rejectionReason: null,
            approvedAt: null,
          },
          saEnvelope,
        );
        const secondBody = requests[1]!.bodyJson!;
        assert.equal(secondBody.p_status, 'PENDING');
        assert.equal(secondBody.p_rejection_reason, null);
        assert.equal(secondBody.p_approved_at, null);
        assert.equal(secondBody.p_set_rejection_reason, true);
        assert.equal(secondBody.p_set_approved_by, false);
        assert.equal(secondBody.p_set_approved_at, true);
      },
    );
  });

  it('safely maps PostgREST SQLSTATE errors and rejects malformed JSON, unexpected HTTP status, timeouts, and unreachable endpoints without secret leakage', async () => {
    // 1. Direct mapPostgrestError SQLSTATE checks
    assert.equal(mapPostgrestError(400, { code: '42501', message: '42501: Self-approval rejected' }).statusCode, 403);
    assert.equal(mapPostgrestError(400, { code: 'P0002', message: 'P0002: Not found' }).statusCode, 404);
    assert.equal(mapPostgrestError(400, { code: '23514', message: 'chk_leave_rejection_reason' }).statusCode, 422);
    assert.equal(mapPostgrestError(400, { code: '55000', message: 'internal detail hidden' }).statusCode, 503);
    assert.equal(mapPostgrestError(500, { code: 'XX000', message: 'postgres secret internal stack' }).message, 'Branch RPC request failed.');

    // 2. Wire error statuses, malformed 200 JSON, and request timeout
    await withLocalHttpServer(
      async (req, res) => {
        if (req.path.endsWith('/rpc/rpc_branch_decide_leave_request')) {
          if (req.headers['x-test-mode'] === 'timeout') {
            await new Promise((r) => setTimeout(r, 200));
          }
          if (req.headers['x-test-mode'] === 'bad-json') {
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end('{not-valid-json');
            return;
          }
          if (req.headers['x-test-mode'] === 'pg-42501') {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ code: '42501', message: '42501: Self-approval by BRANCH_MANAGER is strictly prohibited.' }));
            return;
          }
          res.statusCode = 502;
          res.end('<html>Bad Gateway</html>');
          return;
        }
        res.statusCode = 500;
        res.end('fail');
      },
      async ({ baseUrl }) => {
        const envelope = makeEnvelope();

        // Timeout (504)
        const timeoutClient = new HttpBranchAClient({
          branchASupabaseUrl: baseUrl,
          branchAServiceRoleKey: TEST_SRV_KEY,
          requestTimeoutMs: 40,
          fetchFn: (url, init) =>
            fetch(url, {
              ...init,
              headers: { ...(init?.headers as Record<string, string>), 'x-test-mode': 'timeout' },
            }),
        });
        await assert.rejects(
          () => timeoutClient.decideLeaveRequest({ requestId: envelope.targetId, decision: 'APPROVED', rejectionReason: null }, envelope),
          (err: unknown) => err instanceof GatewayError && err.statusCode === 504 && err.code === 'BRANCH_RPC_TIMEOUT',
        );

        // Malformed 200 JSON (502 BRANCH_RPC_INVALID_RESPONSE)
        const badJsonClient = new HttpBranchAClient({
          branchASupabaseUrl: baseUrl,
          branchAServiceRoleKey: TEST_SRV_KEY,
          fetchFn: (url, init) =>
            fetch(url, {
              ...init,
              headers: { ...(init?.headers as Record<string, string>), 'x-test-mode': 'bad-json' },
            }),
        });
        await assert.rejects(
          () => badJsonClient.decideLeaveRequest({ requestId: envelope.targetId, decision: 'APPROVED', rejectionReason: null }, envelope),
          (err: unknown) => err instanceof GatewayError && err.statusCode === 502 && err.code === 'BRANCH_RPC_INVALID_RESPONSE',
        );

        // PostgREST SQLSTATE 42501 mapped to 403 without secret leakage
        const pgErrClient = new HttpBranchAClient({
          branchASupabaseUrl: baseUrl,
          branchAServiceRoleKey: TEST_SRV_KEY,
          fetchFn: (url, init) =>
            fetch(url, {
              ...init,
              headers: { ...(init?.headers as Record<string, string>), 'x-test-mode': 'pg-42501' },
            }),
        });
        await assert.rejects(
          () => pgErrClient.decideLeaveRequest({ requestId: envelope.targetId, decision: 'APPROVED', rejectionReason: null }, envelope),
          (err: unknown) => {
            if (!(err instanceof GatewayError)) return false;
            const serialized = JSON.stringify(sanitizeForLog({ error: err }));
            return err.statusCode === 403 && !serialized.includes(TEST_SRV_KEY) && !serialized.includes(envelope.actorSig);
          },
        );

        // Unexpected 502 HTML upstream error mapped cleanly
        const unexpectedClient = new HttpBranchAClient({
          branchASupabaseUrl: baseUrl,
          branchAServiceRoleKey: TEST_SRV_KEY,
        });
        await assert.rejects(
          () => unexpectedClient.decideLeaveRequest({ requestId: envelope.targetId, decision: 'APPROVED', rejectionReason: null }, envelope),
          (err: unknown) => err instanceof GatewayError && err.statusCode === 502 && err.code === 'UPSTREAM_RPC_ERROR',
        );
      },
    );

    // 3. Connection failure against unbound closed localhost port -> 503
    const closedServer = http.createServer();
    await new Promise<void>((r) => closedServer.listen(0, '127.0.0.1', () => r()));
    const deadPort = (closedServer.address() as AddressInfo).port;
    await new Promise<void>((r) => closedServer.close(() => r()));

    const unreachableCentral = new HttpCentralClient({
      centralSupabaseUrl: `http://127.0.0.1:${deadPort}`,
      centralServiceRoleKey: TEST_SRV_KEY,
    });
    await assert.rejects(
      () => unreachableCentral.getUserProfileWithBranch('11111111-1111-4111-8111-111111111111'),
      (err: unknown) => err instanceof GatewayError && err.statusCode === 503 && err.code === 'CENTRAL_UNAVAILABLE',
    );
  });
});