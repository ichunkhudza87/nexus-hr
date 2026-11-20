import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { createGatewayServer } from '../app.ts';
import { CentralJwtVerifier } from '../auth/central-jwt.ts';
import type { JwkEntry } from '../auth/central-jwt.ts';
import { IdentityResolver } from '../auth/identity-resolver.ts';
import type { BranchAClient } from '../clients/branch-rpc-client.ts';
import type { CentralDirectoryClient } from '../clients/central-client.ts';
import { GatewayError } from '../errors/gateway-error.ts';
import { ActorHmacSigner } from '../security/hmac-signer.ts';
import { createStructuredLogger } from '../security/log-sanitizer.ts';
import { NonceStore } from '../security/nonce-store.ts';
import { LeaveService } from '../services/leave-service.ts';
import type { CentralUserProfile, LeaveRequestRecord, SignedActorEnvelope } from '../types/domain.ts';

const BRANCH_A_ID = '00000000-0000-0000-0000-000000000001';
const REQ_ID = '99999999-9999-4999-8999-999999999999';
const MGR_ID = '11111111-1111-4111-8111-111111111111';
const MGR_EMP_ID = '22222222-2222-4222-8222-222222222222';
const EMP_USER_ID = '33333333-3333-4333-8333-333333333333';
const EMP_ID = '44444444-4444-4444-8444-444444444444';
const SA_ID = '55555555-5555-4555-8555-555555555555';

const HMAC_SECRET = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

function makeJwt(sub: string, privateKey: KeyObject, issuer: string): string {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'ec-1' })).toString('base64url');
  const p = Buffer.from(
    JSON.stringify({ sub, iss: issuer, aud: 'authenticated', exp: now + 300 }),
  ).toString('base64url');
  const sig = sign('sha256', Buffer.from(`${h}.${p}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `${h}.${p}.${sig}`;
}

describe('Gateway HTTP & LeaveService End-to-End Security Tests (Mocked DB Boundary)', () => {
  const ecPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const ecJwk = {
    ...(ecPair.publicKey.export({ format: 'jwk' }) as JwkEntry),
    kid: 'ec-1',
    use: 'sig',
    alg: 'ES256',
  };
  const issuer = 'https://central.example.supabase.co/auth/v1';

  const profiles = new Map<string, CentralUserProfile>([
    [
      MGR_ID,
      {
        id: MGR_ID,
        email: 'mgr@nexus.local',
        role: 'BRANCH_MANAGER',
        branch_id: BRANCH_A_ID,
        is_active: true,
        branch: { id: BRANCH_A_ID, code: 'BRANCH-A', is_active: true },
      },
    ],
    [
      EMP_USER_ID,
      {
        id: EMP_USER_ID,
        email: 'emp@nexus.local',
        role: 'EMPLOYEE',
        branch_id: BRANCH_A_ID,
        is_active: true,
        branch: { id: BRANCH_A_ID, code: 'BRANCH-A', is_active: true },
      },
    ],
    [
      SA_ID,
      {
        id: SA_ID,
        email: 'sa@nexus.local',
        role: 'SUPERADMIN',
        branch_id: null,
        is_active: true,
        branch: null,
      },
    ],
  ]);

  async function withTestServer(
    fn: (ctx: {
      baseUrl: string;
      capturedEnvelopes: SignedActorEnvelope[];
      logLines: string[];
      signer: ActorHmacSigner;
    }) => Promise<void>,
  ) {
    const capturedEnvelopes: SignedActorEnvelope[] = [];
    const logLines: string[] = [];

    const jwtVerifier = new CentralJwtVerifier({
      jwksUrl: `${issuer}/.well-known/jwks.json`,
      expectedIssuer: issuer,
      expectedAudience: 'authenticated',
      fetchFn: async () =>
        new Response(JSON.stringify({ keys: [ecJwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });

    const centralClient: CentralDirectoryClient = {
      getUserProfileWithBranch: async (userId) => profiles.get(userId) ?? null,
    };

    const branchClient: BranchAClient = {
      getEmployeesByAuthId: async (uid) => {
        if (uid === MGR_ID) return [{ id: MGR_EMP_ID, user_auth_id: MGR_ID, is_active: true, is_deleted: false }];
        if (uid === EMP_USER_ID) return [{ id: EMP_ID, user_auth_id: EMP_USER_ID, is_active: true, is_deleted: false }];
        return [];
      },
      decideLeaveRequest: async (input, envelope) => {
        capturedEnvelopes.push(envelope);
        // Simulate DB self-approval / status check boundary
        if (input.requestId === '88888888-8888-4888-8888-888888888888') {
          throw new GatewayError(403, 'FORBIDDEN', '42501: Self-approval by BRANCH_MANAGER is strictly prohibited.');
        }
        return {
          id: input.requestId,
          employee_id: EMP_ID,
          leave_type: 'ANNUAL',
          start_date: '2026-12-01',
          end_date: '2026-12-02',
          total_days: 2,
          reason: 'Family event',
          status: input.decision,
          submitted_at: '2026-11-11T00:00:00Z',
          approved_by: envelope.actorUserId,
          approved_at: '2026-11-11T10:00:00Z',
          rejection_reason: input.rejectionReason,
          created_at: '2026-11-11T00:00:00Z',
          updated_at: '2026-11-11T10:00:00Z',
        } satisfies LeaveRequestRecord;
      },
      superadminUpdateLeaveRequest: async (input, envelope) => {
        capturedEnvelopes.push(envelope);
        return {
          id: input.requestId,
          employee_id: input.employeeId ?? EMP_ID,
          leave_type: input.leaveType ?? 'SICK',
          start_date: input.startDate ?? '2026-12-01',
          end_date: input.endDate ?? '2026-12-02',
          total_days: input.totalDays ?? 2,
          reason: input.reason ?? 'Corrected reason',
          status: input.status ?? 'APPROVED',
          submitted_at: '2026-11-11T00:00:00Z',
          approved_by: input.approvedBy ?? envelope.actorUserId,
          approved_at: input.approvedAt ?? '2026-11-11T10:00:00Z',
          rejection_reason: input.rejectionReason ?? null,
          created_at: '2026-11-11T00:00:00Z',
          updated_at: '2026-11-11T10:00:00Z',
        } satisfies LeaveRequestRecord;
      },
    };

    const identityResolver = new IdentityResolver({
      centralClient,
      branchClient,
      expectedBranchAId: BRANCH_A_ID,
      expectedBranchACode: 'BRANCH-A',
    });

    const signer = new ActorHmacSigner(
      [{ keyId: 'gw-v1', secret: HMAC_SECRET, isActive: true, createdAt: '2026-11-11T00:00:00Z', rotatedAt: null, revokedAt: null }],
      'gw-v1',
    );
    const nonceStore = new NonceStore();
    const logger = createStructuredLogger((line) => logLines.push(line));
    const leaveService = new LeaveService({
      branchClient,
      hmacSigner: signer,
      nonceStore,
      actorTtlSeconds: 60,
      logger,
    });

    const server = createGatewayServer({
      jwtVerifier,
      identityResolver,
      leaveService,
      nonceStore,
      hmacSigner: signer,
      branchAId: BRANCH_A_ID,
      logger,
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      await fn({ baseUrl, capturedEnvelopes, logLines, signer });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  }

  it('rejects client-supplied actor_id, actor_role, branch_id, and field-tampering attempts', async () => {
    await withTestServer(async ({ baseUrl, capturedEnvelopes }) => {
      const mgrJwt = makeJwt(MGR_ID, ecPair.privateKey, issuer);

      for (const forgedPayload of [
        { decision: 'APPROVED', actor_id: SA_ID },
        { decision: 'APPROVED', actor_role: 'SUPERADMIN' },
        { decision: 'APPROVED', branch_id: BRANCH_A_ID },
        { decision: 'APPROVED', approved_by: SA_ID },
        { decision: 'APPROVED', total_days: 0.5 },
      ]) {
        const res = await fetch(`${baseUrl}/api/v1/leave-requests/${REQ_ID}/decide`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${mgrJwt}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(forgedPayload),
        });
        assert.equal(res.status, 400);
        const body = (await res.json()) as { error: { code: string } };
        assert.equal(body.error.code, 'FORBIDDEN_IDENTITY_FIELD');
      }
      assert.equal(capturedEnvelopes.length, 0);
    });
  });

  it('blocks EMPLOYEE role from calling manager decision or superadmin endpoints', async () => {
    await withTestServer(async ({ baseUrl, capturedEnvelopes }) => {
      const empJwt = makeJwt(EMP_USER_ID, ecPair.privateKey, issuer);

      const res1 = await fetch(`${baseUrl}/api/v1/leave-requests/${REQ_ID}/decide`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${empJwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ decision: 'APPROVED' }),
      });
      assert.equal(res1.status, 403);

      const res2 = await fetch(`${baseUrl}/api/v1/admin/leave-requests/${REQ_ID}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${empJwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ operation_mode: 'CORRECTION', status: 'APPROVED' }),
      });
      assert.equal(res2.status, 403);
      assert.equal(capturedEnvelopes.length, 0);
    });
  });

  it('issues verifiable HMAC envelope for BRANCH_MANAGER and SUPERADMIN without leaking secrets to logs', async () => {
    await withTestServer(async ({ baseUrl, capturedEnvelopes, logLines, signer }) => {
      const mgrJwt = makeJwt(MGR_ID, ecPair.privateKey, issuer);
      const reqNonce = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

      const mgrRes = await fetch(`${baseUrl}/api/v1/leave-requests/${REQ_ID}/decide`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${mgrJwt}`,
          'content-type': 'application/json',
          'x-request-nonce': reqNonce,
        },
        body: JSON.stringify({ decision: 'APPROVED' }),
      });
      assert.equal(mgrRes.status, 200);
      assert.equal(capturedEnvelopes.length, 1);
      const mgrEnv = capturedEnvelopes[0]!;
      assert.equal(mgrEnv.actorUserId, MGR_ID);
      assert.equal(mgrEnv.actorRole, 'BRANCH_MANAGER');
      assert.equal(mgrEnv.employeeId, MGR_EMP_ID);
      assert.equal(signer.verifyEnvelope(mgrEnv, Math.floor(Date.now() / 1000)), true);

      // Replaying same X-Request-Nonce must fail 409
      const replayRes = await fetch(`${baseUrl}/api/v1/leave-requests/${REQ_ID}/decide`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${mgrJwt}`,
          'content-type': 'application/json',
          'x-request-nonce': reqNonce,
        },
        body: JSON.stringify({ decision: 'APPROVED' }),
      });
      assert.equal(replayRes.status, 409);

      // SUPERADMIN CORRECTION flow
      const saJwt = makeJwt(SA_ID, ecPair.privateKey, issuer);
      const saRes = await fetch(`${baseUrl}/api/v1/admin/leave-requests/${REQ_ID}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${saJwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          operation_mode: 'CORRECTION',
          leave_type: 'SICK',
          total_days: 3,
          reason: 'Corrected medical cert',
        }),
      });
      assert.equal(saRes.status, 200);
      assert.equal(capturedEnvelopes.length, 2);
      const saEnv = capturedEnvelopes[1]!;
      assert.equal(saEnv.actorUserId, SA_ID);
      assert.equal(saEnv.actorRole, 'SUPERADMIN');
      assert.equal(saEnv.operationMode, 'CORRECTION');
      assert.equal(signer.verifyEnvelope(saEnv, Math.floor(Date.now() / 1000)), true);

      // Ensure zero secrets, JWTs, or HMAC hex signatures appear anywhere in structured logs
      const allLogs = logLines.join('\n');
      assert.equal(allLogs.includes(HMAC_SECRET), false);
      assert.equal(allLogs.includes(mgrEnv.actorSig), false);
      assert.equal(allLogs.includes(mgrJwt), false);
      assert.equal(allLogs.includes(saJwt), false);
    });
  });

  it('exposes secret-free /health endpoint', async () => {
    await withTestServer(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/health`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.equal(text.includes(HMAC_SECRET), false);
      const json = JSON.parse(text) as { status: string; activeSigningKeyId: string };
      assert.equal(json.status, 'ok');
      assert.equal(json.activeSigningKeyId, 'gw-v1');
    });
  });
});
