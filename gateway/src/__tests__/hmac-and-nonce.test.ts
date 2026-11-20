import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  ActorHmacSigner,
  buildCanonicalActorPayload,
  buildCanonicalActorPayloadV26,
} from '../security/hmac-signer.ts';
import { NonceStore } from '../security/nonce-store.ts';
import type { ResolvedActor } from '../types/domain.ts';

describe('ActorHmacSigner & NonceStore (Unit Tests)', () => {
  const secretV1 = '1111111111111111111111111111111111111111111111111111111111111111';
  const secretV2 = '2222222222222222222222222222222222222222222222222222222222222222';

  const managerActor: ResolvedActor = {
    actorUserId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
    actorEmail: ' Manager@BranchA.local ',
    actorRole: 'BRANCH_MANAGER',
    branchId: '00000000-0000-0000-0000-000000000001',
    employeeId: 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB',
  };

  it('builds v2.7 12-field canonical string binding version and keyId identically to SQL v2.7', () => {
    const canonical = buildCanonicalActorPayload({
      keyId: 'gw-v1',
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
        'v2.7',
        'gw-v1',
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

    // Explicitly prove legacy v2.6 10-field signatures are rejected under v2.7 verification
    const legacyCanonical = buildCanonicalActorPayloadV26({
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
    const legacySig = createHmac('sha256', Buffer.from(secretV1, 'utf8'))
      .update(Buffer.from(legacyCanonical, 'utf8'))
      .digest('hex');
    assert.equal(signer.verifyEnvelope({ ...envelope, actorSig: legacySig }, 1_800_000_000), false);
  });

  it('detects keyId tampering, key selection mismatch, unknown keys, expired keys, and field tampering', () => {
    let now = 1_800_000_000;
    const signer = new ActorHmacSigner(
      [{ keyId: 'gw-v1', secret: secretV1, isActive: true, createdAt: '2026-11-11T00:00:00Z', rotatedAt: null, revokedAt: null }],
      'gw-v1',
      { nowEpochFn: () => now },
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
    // Unknown key ID fails closed
    assert.equal(signer.verifyEnvelope({ ...valid, keyId: 'gw-unknown' }, now), false);
    // Rotate with v2 active: substituting keyId='gw-v2' or signing with v1 fails when keyId tampered or mismatched
    signer.rotateKey('gw-v2', secretV2, { keepPreviousValid: true, gracePeriodSeconds: 120 });
    assert.equal(signer.verifyEnvelope({ ...valid, keyId: 'gw-v2' }, now), false);
    // Expired envelope
    assert.equal(signer.verifyEnvelope(valid, now + 61), false);
    // TTL > 120s
    assert.equal(signer.verifyEnvelope({ ...valid, exp: now + 121 }, now), false);
    // Grace-period key expiration (gw-v1 expires at now + 120s)
    now += 120;
    assert.equal(signer.verifyEnvelope({ ...valid, exp: now + 30 }, now), false);
  });

  it('supports grace-period rotation, concurrent in-flight verification, and immediate revocation', async () => {
    let now = 1_800_000_000;
    const signer = new ActorHmacSigner(
      [{ keyId: 'gw-v1', secret: secretV1, isActive: true, createdAt: '2026-11-11T00:00:00Z', rotatedAt: null, revokedAt: null }],
      'gw-v1',
      { nowEpochFn: () => now },
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

    // Concurrent signing during rotation always uses active key v2 cleanly
    const concurrentEnvs = await Promise.all(
      Array.from({ length: 10 }, (_, idx) =>
        Promise.resolve().then(() =>
          signer.signActorEnvelope({
            actionScope: 'LEAVE_DECIDE',
            targetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            operationMode: 'DECISION',
            actor: managerActor,
            exp: now + 60,
            nonce: `eeeeeeee-eeee-4eee-8eee-00000000000${idx}`,
          }),
        ),
      ),
    );
    assert.equal(concurrentEnvs.every((e) => e.keyId === 'gw-v2' && signer.verifyEnvelope(e, now)), true);

    // Revoke v1 immediately -> v1 envelopes fail verification, v2 remains valid
    signer.revokeKey('gw-v1');
    assert.equal(signer.verifyEnvelope(envV1, now), false);
    assert.equal(signer.verifyEnvelope(concurrentEnvs[0]!, now), true);

    // Revoking active key fails closed on next sign attempt (503)
    signer.revokeKey('gw-v2');
    assert.throws(() => signer.getActiveKey(now), /SIGNING_KEY_UNAVAILABLE|revoked/);
  });

  it('detects outbound CSPRNG collisions in out: namespace, isolates inbound/outbound namespaces, expires & prunes', async () => {
    let now = 1_800_000_000;
    const fixedUuid = '123e4567-e89b-42d3-a456-426614174000';
    const collidingStore = new NonceStore({
      nowEpochFn: () => now,
      uuidFn: () => fixedUuid,
    });

    // First outbound nonce succeeds and records under 'out:'
    const first = collidingStore.issueOutboundNonce(60);
    assert.equal(first.nonce, fixedUuid);
    assert.equal(collidingStore.size(), 1);

    // Collision check MUST detect active 'out:' key (Remediation B-4)
    assert.throws(() => collidingStore.issueOutboundNonce(60), /NONCE_COLLISION|collision/i);

    // Inbound 'req:' namespace MUST remain isolated from 'out:' namespace for the same UUID
    collidingStore.consumeInboundNonce('req', fixedUuid, 60);
    assert.equal(collidingStore.size(), 2);
    assert.throws(() => collidingStore.consumeInboundNonce('req', fixedUuid, 60), /Replayed request/);

    // Attempting to inject into internal 'out' inbound namespace is rejected
    assert.throws(() => collidingStore.consumeInboundNonce('out', fixedUuid, 60), /Invalid nonce namespace/);

    // Expiry & pruning clears both after TTL advances
    now += 61;
    const reissued = collidingStore.issueOutboundNonce(60);
    assert.equal(reissued.nonce, fixedUuid);
    assert.equal(collidingStore.size(), 1);

    // Concurrent real CSPRNG issuance generates unique UUIDv4s cleanly
    const liveStore = new NonceStore({ nowEpochFn: () => now });
    const issued = await Promise.all(
      Array.from({ length: 50 }, () => Promise.resolve().then(() => liveStore.issueOutboundNonce(60))),
    );
    const uniqueNonces = new Set(issued.map((x) => x.nonce));
    assert.equal(uniqueNonces.size, 50);
  });
});
