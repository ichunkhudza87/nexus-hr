import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadGatewayConfig } from '../config/env.ts';
import { GatewayError, mapPostgrestError } from '../errors/gateway-error.ts';
import { ActorHmacSigner } from '../security/hmac-signer.ts';

const VALID_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('SEC-41 Remediation & Security Hardening Tests', () => {
  describe('SEC-41-01 — activatedAt validation', () => {
    it('ActorHmacSigner rejects signing when active key has activatedAt in the future', () => {
      const nowEpoch = 1_700_000_000;
      const futureIso = new Date((nowEpoch + 3600) * 1000).toISOString();

      assert.throws(
        () =>
          new ActorHmacSigner(
            [
              {
                keyId: 'future-key',
                secret: VALID_SECRET,
                isActive: true,
                createdAt: new Date(nowEpoch * 1000).toISOString(),
                activatedAt: futureIso,
                rotatedAt: null,
                expiresAt: null,
                revokedAt: null,
              },
            ],
            'future-key',
            { nowEpochFn: () => nowEpoch },
          ),
        (err) => err instanceof GatewayError && err.statusCode === 503 && err.code === 'SIGNING_KEY_UNAVAILABLE',
      );
    });

    it('ActorHmacSigner allows active key when activatedAt is current or in the past', () => {
      const nowEpoch = 1_700_000_000;
      const pastIso = new Date((nowEpoch - 60) * 1000).toISOString();
      const exactIso = new Date(nowEpoch * 1000).toISOString();

      const signer = new ActorHmacSigner(
        [
          {
            keyId: 'past-key',
            secret: VALID_SECRET,
            isActive: true,
            createdAt: pastIso,
            activatedAt: pastIso,
            rotatedAt: null,
            expiresAt: null,
            revokedAt: null,
          },
          {
            keyId: 'exact-key',
            secret: VALID_SECRET,
            isActive: true,
            createdAt: exactIso,
            activatedAt: exactIso,
            rotatedAt: null,
            expiresAt: null,
            revokedAt: null,
          },
        ],
        'past-key',
        { nowEpochFn: () => nowEpoch },
      );

      assert.equal(signer.getActiveKey().keyId, 'past-key');
    });

    it('ActorHmacSigner verifyEnvelope rejects envelope if key activatedAt is in the future', () => {
      const nowEpoch = 1_700_000_000;
      const signer = new ActorHmacSigner(
        [
          {
            keyId: 'future-key',
            secret: VALID_SECRET,
            isActive: true,
            createdAt: new Date(nowEpoch * 1000).toISOString(),
            activatedAt: new Date((nowEpoch + 100) * 1000).toISOString(),
            rotatedAt: null,
            expiresAt: null,
            revokedAt: null,
          },
        ],
        'future-key',
        { nowEpochFn: () => nowEpoch + 200 }, // activated at signing time
      );

      const envelope = signer.signActorEnvelope({
        actionScope: 'LEAVE_DECIDE',
        targetId: '00000000-0000-0000-0000-000000000001',
        operationMode: 'DECISION',
        actor: {
          actorUserId: '00000000-0000-0000-0000-000000000002',
          actorEmail: 'mgr@nexus.local',
          actorRole: 'BRANCH_MANAGER',
          branchId: '00000000-0000-0000-0000-000000000003',
          employeeId: '00000000-0000-0000-0000-000000000004',
        },
        exp: nowEpoch + 50,
        nonce: '00000000-0000-0000-0000-000000000005',
      });

      // Verification attempted when nowEpoch is before activation time
      const verified = signer.verifyEnvelope(envelope, nowEpoch);
      assert.equal(verified, false);
    });

    it('loadGatewayConfig rejects key ring entry with invalid activatedAt timestamp', () => {
      const baseEnv = {
        PORT: '3000',
        SUPABASE_CENTRAL_URL: 'http://localhost:54321',
        SUPABASE_CENTRAL_SERVICE_ROLE_KEY: 'central-secret',
        SUPABASE_BRANCH_A_URL: 'http://localhost:54322',
        SUPABASE_BRANCH_A_SERVICE_ROLE_KEY: 'branch-secret',
        GATEWAY_ACTOR_HMAC_KEYS_JSON: JSON.stringify([
          {
            keyId: 'key-1',
            secret: VALID_SECRET,
            isActive: true,
            activatedAt: 'not-a-timestamp',
          },
        ]),
      };

      assert.throws(
        () => loadGatewayConfig(baseEnv),
        (err) => err instanceof GatewayError && err.message.includes('Invalid activatedAt'),
      );
    });
  });

  describe('SEC-41-02 — Database Error Sanitization', () => {
    it('mapPostgrestError sanitizes 23505 unique violation messages from HTTP output', () => {
      const rawPgError = {
        code: '23505',
        message: 'duplicate key value violates unique constraint "uq_branches_code"',
        details: 'Key (code)=(BRANCH-A) already exists.',
      };

      const err = mapPostgrestError(409, rawPgError);
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'BUSINESS_RULE_VIOLATION');
      assert.equal(err.message, 'A conflicting record already exists.');
      // Ensure raw table/constraint text does NOT appear in client message
      assert.equal(err.message.includes('uq_branches_code'), false);
      assert.equal(err.message.includes('duplicate key value'), false);
      // Ensure internal detail is captured for logging
      assert.equal(err.internalDetail?.pgCode, '23505');
      assert.equal(err.internalDetail?.pgMessage, rawPgError.message);
    });

    it('mapPostgrestError sanitizes 23503 foreign key violation messages from HTTP output', () => {
      const rawPgError = {
        code: '23503',
        message: 'insert or update on table "leave_requests" violates foreign key constraint "fk_employee"',
        details: 'Key (employee_id)=(123) is not present in table "employees".',
      };

      const err = mapPostgrestError(409, rawPgError);
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'BUSINESS_RULE_VIOLATION');
      assert.equal(err.message, 'Referenced record does not exist or cannot be linked.');
      assert.equal(err.message.includes('fk_employee'), false);
      assert.equal(err.message.includes('leave_requests'), false);
      assert.equal(err.internalDetail?.pgCode, '23503');
    });
  });
});
