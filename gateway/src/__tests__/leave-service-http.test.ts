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
import type {
  CentralUserProfile,
  LeaveRequestRecord,
  SignedActorEnvelope,
  SuperadminLeaveUpdateInput,
} from '../types/domain.ts';

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
      capturedSuperadminInputs: SuperadminLeaveUpdateInput[];
      mockRow: LeaveRequestRecord;
      mockAuditCount: () => number;
      logLines: string[];
      signer: ActorHmacSigner;
    }) => Promise<void>,
  ) {
    const capturedEnvelopes: SignedActorEnvelope[] = [];
    const capturedSuperadminInputs: SuperadminLeaveUpdateInput[] = [];
    const logLines: string[] = [];
    let auditCount = 0;

    // Seed mock DB row with existing approval/rejection metadata to detect silent NULL-overwrite bugs (B-2)
    let mockRow: LeaveRequestRecord = {
      id: REQ_ID,
      employee_id: EMP_ID,
      leave_type: 'ANNUAL',
      start_date: '2026-12-01',
      end_date: '2026-12-02',
      total_days: 2,
      reason: 'Family event',
      status: 'REJECTED',
      submitted_at: '2026-11-11T00:00:00Z',
      approved_by: MGR_ID,
      approved_at: '2026-11-11T09:00:00Z',
      rejection_reason: 'Original manager reason',
      created_at: '2026-11-11T00:00:00Z',
      updated_at: '2026-11-11T09:00:00Z',
    };

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
        if (input.requestId === '88888888-8888-4888-8888-888888888888') {
          throw new GatewayError(403, 'FORBIDDEN', '42501: Self-approval by BRANCH_MANAGER is strictly prohibited.');
        }
        auditCount += 1;
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
        capturedSuperadminInputs.push(input);
        // Simulate exact SQL v2.7 partial-update preservation + final row constraint validation (transactional rollback)
        const nextRow: LeaveRequestRecord = {
          ...mockRow,
          employee_id: input.employeeId ?? mockRow.employee_id,
          leave_type: input.leaveType ?? mockRow.leave_type,
          start_date: input.startDate ?? mockRow.start_date,
          end_date: input.endDate ?? mockRow.end_date,
          total_days: input.totalDays ?? mockRow.total_days,
          reason: input.reason ?? mockRow.reason,
          status: input.status ?? mockRow.status,
          rejection_reason:
            input.rejectionReason !== undefined ? input.rejectionReason : mockRow.rejection_reason,
          approved_by: input.approvedBy !== undefined ? input.approvedBy : mockRow.approved_by,
          approved_at: input.approvedAt !== undefined ? input.approvedAt : mockRow.approved_at,
          updated_at: '2026-11-11T10:00:00Z',
        };
        if (nextRow.end_date < nextRow.start_date) {
          throw new GatewayError(422, 'VALIDATION_ERROR', 'chk_leave_dates violation');
        }
        if (nextRow.status === 'REJECTED' && !nextRow.rejection_reason) {
          throw new GatewayError(422, 'VALIDATION_ERROR', 'chk_leave_rejection_reason violation');
        }
        mockRow = nextRow;
        auditCount += 1;
        return nextRow;
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
      await fn({
        baseUrl,
        capturedEnvelopes,
        capturedSuperadminInputs,
        mockRow,
        mockAuditCount: () => auditCount,
        logLines,
        signer,
      });
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
        { decision: 'APPROVED', p_key_id: 'gw-v2' },
        { decision: 'APPROVED', p_actor_email: 'spoof@nexus.local' },
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

  it('handles SUPERADMIN partial CORRECTION preserving omitted fields while rejecting invalid explicit nulls and failed constraints (Mocked DB Boundary)', async () => {
    await withTestServer(async ({ baseUrl, capturedSuperadminInputs, mockRow, mockAuditCount }) => {
      const saJwt = makeJwt(SA_ID, ecPair.privateKey, issuer);

      // 1. Single-field CORRECTION on REJECTED row preserves rejection_reason, approved_by, approved_at
      const res1 = await fetch(`${baseUrl}/api/v1/admin/leave-requests/${REQ_ID}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${saJwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          operation_mode: 'CORRECTION',
          total_days: 1,
        }),
      });
      assert.equal(res1.status, 200);
      const body1 = (await res1.json()) as { data: LeaveRequestRecord };
      assert.equal(body1.data.total_days, 1);
      assert.equal(body1.data.rejection_reason, 'Original manager reason');
      assert.equal(body1.data.approved_by, MGR_ID);
      assert.equal(body1.data.approved_at, '2026-11-11T09:00:00Z');
      assert.equal(capturedSuperadminInputs[0]!.rejectionReason, undefined);
      assert.equal(capturedSuperadminInputs[0]!.approvedBy, undefined);
      assert.equal(capturedSuperadminInputs[0]!.approvedAt, undefined);
      assert.equal(mockAuditCount(), 1);

      // 2. Explicit null rejection_reason when REJECTED fails closed (422 DB constraint) and leaves row + audit unchanged
      const res2 = await fetch(`${baseUrl}/api/v1/admin/leave-requests/${REQ_ID}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${saJwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          operation_mode: 'CORRECTION',
          rejection_reason: null,
        }),
      });
      assert.equal(res2.status, 422);
      assert.equal(mockAuditCount(), 1);
      assert.equal(mockRow.rejection_reason, 'Original manager reason');

      // 3. Explicit null on non-nullable column (status: null) rejected at Gateway (400)
      const res3 = await fetch(`${baseUrl}/api/v1/admin/leave-requests/${REQ_ID}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${saJwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          operation_mode: 'CORRECTION',
          status: null,
        }),
      });
      assert.equal(res3.status, 400);
      assert.equal(mockAuditCount(), 1);

      // 4. Explicit valid clear of rejection_reason & approved_* when returning status to PENDING succeeds
      const res4 = await fetch(`${baseUrl}/api/v1/admin/leave-requests/${REQ_ID}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${saJwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          operation_mode: 'CORRECTION',
          status: 'PENDING',
          rejection_reason: null,
          approved_by: null,
          approved_at: null,
        }),
      });
      assert.equal(res4.status, 200);
      const body4 = (await res4.json()) as { data: LeaveRequestRecord };
      assert.equal(body4.data.status, 'PENDING');
      assert.equal(body4.data.rejection_reason, null);
      assert.equal(body4.data.approved_by, null);
      assert.equal(body4.data.approved_at, null);
      assert.equal(mockAuditCount(), 2);

      // 5. Transitioning PENDING -> REJECTED without rejection_reason fails resulting row validation (422) without incrementing audit
      const res5 = await fetch(`${baseUrl}/api/v1/admin/leave-requests/${REQ_ID}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${saJwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          operation_mode: 'CORRECTION',
          status: 'REJECTED',
        }),
      });
      assert.equal(res5.status, 422);
      assert.equal(mockAuditCount(), 2);
    });
  });
});
