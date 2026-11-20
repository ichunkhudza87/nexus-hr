import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { ActorHmacSigner, buildCanonicalActorPayload } from '../security/hmac-signer.ts';
import { NonceStore } from '../security/nonce-store.ts';
import type { ResolvedActor } from '../types/domain.ts';

describe('ActorHmacSigner & NonceStore', () => {
  const secretV1 = '1111111111111111111111111111111111111111111111111111111111111111';
  const secretV2 = '2222222222222222222222222222222222222222222222222222222222222222';

  const managerActor: ResolvedActor = {
    actorUserId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
    actorEmail: ' Manager@BranchA.local ',
    actorRole: 'BRANCH_MANAGER',
    branchId: '00000000-0000-0000-0000-000000000001',
    employeeId: 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB',
  };

  it('builds canonical string matching PostgreSQL verify_gateway_actor() exact contract', () => {
    const canonical = buildCanonicalActorPayload({
      actionScope: 'LEAVE_DECIDE',
      targetId: 'CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC',
      operationMode: 'DECISION',
      actorUserId: managerActor.actorUserId,
      actorEmail: managerActor.actorEmail,
      actorRole: managerActor.actorRole,
      branchId: managerActor.branchId,
      employeeId: managerActor.employeeId,
      exp: 1800000060,
      nonce: 'DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDDD',
    });

    assert.equal(
      canonical,
      [
        'LEAVE_DECIDE',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'DECISION',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'manager@brancha.local',
        'BRANCH_MANAGER',
        '00000000-0000-0000-0000-000000000001',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        '1800000060',
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      ].join('|'),
    );

    // Matches direct PostgreSQL extensions.hmac(..., 'sha256') hex digest
    const expectedHex = createHmac('sha256', Buffer.from(secretV1, 'utf8'))
      .update(Buffer.from(canonical, 'utf8'))
      .digest('hex');

    const signer = new ActorHmacSigner(
      [{ keyId: 'gw-v1', secret: secretV1, isActive: true, createdAt: '2026-11-11T00:00:00Z', rotatedAt: null, revokedAt: null }],
      'gw-v1',
    );
    const envelope = signer.signActorEnvelope({
      actionScope: 'LEAVE_DECIDE',
      targetId: 'CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC',
      operationMode: 'DECISION',
      actor: managerActor,
      exp: 1800000060,
      nonce: 'DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDDD',
    });
    assert.equal(envelope.actorSig, expectedHex);
  });

  it('detects tampered actorUserId, actorRole, targetId, and expired/overlong TTL envelopes', () => {
    const now = 1_800_000_000;
    const signer = new ActorHmacSigner(
      [{ keyId: 'gw-v1', secret: secretV1, isActive: true, createdAt: '2026-11-11T00:00:00Z', rotatedAt: null, revokedAt: null }],
      'gw-v1',
    );
    const valid = signer.signActorEnvelope({
      actionScope: 'LEAVE_DECIDE',
      targetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      operationMode: 'DECISION',
      actor: managerActor,
      exp: now + 60,
      nonce: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    });

    assert.equal(signer.verifyEnvelope(valid, now), true);
    assert.equal(signer.verifyEnvelope({ ...valid, actorRole: 'SUPERADMIN' }, now), false);
    assert.equal(signer.verifyEnvelope({ ...valid, actorUserId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }, now), false);
    assert.equal(signer.verifyEnvelope({ ...valid, targetId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }, now), false);
    // Expired
    assert.equal(signer.verifyEnvelope(valid, now + 61), false);
    // TTL > 120s
    assert.equal(signer.verifyEnvelope({ ...valid, exp: now + 121 }, now), false);
  });

  it('supports zero-downtime key rotation and immediate key revocation', () => {
    const now = 1_800_000_000;
    const signer = new ActorHmacSigner(
      [{ keyId: 'gw-v1', secret: secretV1, isActive: true, createdAt: '2026-11-11T00:00:00Z', rotatedAt: null, revokedAt: null }],
      'gw-v1',
    );

    const envV1 = signer.signActorEnvelope({
      actionScope: 'LEAVE_DECIDE',
      targetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      operationMode: 'DECISION',
      actor: managerActor,
      exp: now + 60,
      nonce: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    });

    // Rotate to v2 while keeping v1 in grace window
    signer.rotateKey('gw-v2', secretV2, true);
    assert.equal(signer.getActiveKeyId(), 'gw-v2');
    assert.equal(signer.verifyEnvelope(envV1, now), true);

    const envV2 = signer.signActorEnvelope({
      actionScope: 'LEAVE_DECIDE',
      targetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      operationMode: 'DECISION',
      actor: managerActor,
      exp: now + 60,
      nonce: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    });
    assert.equal(envV2.keyId, 'gw-v2');
    assert.equal(signer.verifyEnvelope(envV2, now), true);

    // Revoke v1 immediately -> in-flight v1 envelopes fail verification, v2 remains valid
    signer.revokeKey('gw-v1');
    assert.equal(signer.verifyEnvelope(envV1, now), false);
    assert.equal(signer.verifyEnvelope(envV2, now), true);
  });

  it('prevents replay of inbound nonces until expiry', () => {
    let now = 1_800_000_000;
    const store = new NonceStore({ nowEpochFn: () => now });

    const out = store.issueOutboundNonce(60);
    assert.match(out.nonce, /^[0-9a-f-]{36}$/);
    assert.equal(out.exp, now + 60);

    const reqNonce = '123e4567-e89b-42d3-a456-426614174000';
    store.consumeInboundNonce('req', reqNonce, 60);
    assert.throws(() => store.consumeInboundNonce('req', reqNonce, 60), /Replayed request/);

    // After TTL expiration, pruned safely
    now += 61;
    store.consumeInboundNonce('req', reqNonce, 60);
  });
});
