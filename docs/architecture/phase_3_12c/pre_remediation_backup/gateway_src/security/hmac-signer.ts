import { createHmac, timingSafeEqual } from 'node:crypto';
import { GatewayError } from '../errors/gateway-error.ts';
import type {
  ActionScope,
  HmacSigningKeyRecord,
  OperationMode,
  ResolvedActor,
  SignedActorEnvelope,
} from '../types/domain.ts';

export interface CanonicalPayloadInput {
  actionScope: ActionScope;
  targetId: string;
  operationMode: OperationMode;
  actorUserId: string;
  actorEmail: string;
  actorRole: string;
  branchId: string | null;
  employeeId: string | null;
  exp: number;
  nonce: string;
}

/**
 * Builds the exact canonical string expected by PostgreSQL function
 * nexus_internal.verify_gateway_actor() (PHASE_3_12A_REMEDIATION_V2_6.sql lines 189-200).
 */
export function buildCanonicalActorPayload(input: CanonicalPayloadInput): string {
  return [
    input.actionScope,
    input.targetId.trim().toLowerCase(),
    input.operationMode,
    input.actorUserId.trim().toLowerCase(),
    input.actorEmail.trim().toLowerCase(),
    input.actorRole,
    input.branchId ? input.branchId.trim().toLowerCase() : '',
    input.employeeId ? input.employeeId.trim().toLowerCase() : '',
    String(input.exp),
    input.nonce.trim().toLowerCase(),
  ].join('|');
}

export function computeActorHmacHex(canonicalPayload: string, secret: string): string {
  return createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(Buffer.from(canonicalPayload, 'utf8'))
    .digest('hex');
}

/**
 * Manages active HMAC signing keys with support for zero-downtime key rotation
 * and immediate key revocation.
 */
export class ActorHmacSigner {
  private readonly keys = new Map<string, HmacSigningKeyRecord>();
  private activeKeyId: string;

  constructor(initialKeys: HmacSigningKeyRecord[], activeKeyId: string) {
    if (initialKeys.length === 0) {
      throw new GatewayError(500, 'CONFIG_ERROR', 'At least one HMAC signing key is required.');
    }
    for (const k of initialKeys) {
      this.keys.set(k.keyId, { ...k });
    }
    this.activeKeyId = activeKeyId;
    this.getActiveKey();
  }

  getActiveKeyId(): string {
    return this.activeKeyId;
  }

  listKeyMetadata(): Array<Omit<HmacSigningKeyRecord, 'secret'>> {
    return Array.from(this.keys.values()).map(({ secret: _secret, ...safe }) => safe);
  }

  getActiveKey(): HmacSigningKeyRecord {
    const key = this.keys.get(this.activeKeyId);
    if (!key || !key.isActive || key.revokedAt !== null) {
      throw new GatewayError(503, 'SIGNING_KEY_UNAVAILABLE', 'Active HMAC signing key is missing or revoked.');
    }
    return key;
  }

  /**
   * Registers a new active signing key and marks the previous key rotated
   * (optionally keeping the previous key valid during grace window until revoked).
   */
  rotateKey(newKeyId: string, newSecret: string, keepPreviousValid = true): void {
    const trimmedId = newKeyId.trim();
    if (!trimmedId || Buffer.byteLength(newSecret, 'utf8') < 32) {
      throw new GatewayError(400, 'INVALID_KEY', 'Rotated HMAC key requires valid keyId and >=32-byte secret.');
    }

    const nowIso = new Date().toISOString();
    const prev = this.keys.get(this.activeKeyId);
    if (prev) {
      prev.rotatedAt = nowIso;
      if (!keepPreviousValid) {
        prev.isActive = false;
      }
    }

    this.keys.set(trimmedId, {
      keyId: trimmedId,
      secret: newSecret,
      isActive: true,
      createdAt: nowIso,
      rotatedAt: null,
      revokedAt: null,
    });
    this.activeKeyId = trimmedId;
  }

  /**
   * Immediately revokes a compromised or retired key ID.
   */
  revokeKey(keyId: string): void {
    const key = this.keys.get(keyId);
    if (!key) {
      throw new GatewayError(404, 'KEY_NOT_FOUND', `Signing key ${keyId} not found.`);
    }
    key.isActive = false;
    key.revokedAt = new Date().toISOString();
  }

  signActorEnvelope(params: {
    actionScope: ActionScope;
    targetId: string;
    operationMode: OperationMode;
    actor: ResolvedActor;
    exp: number;
    nonce: string;
  }): SignedActorEnvelope {
    const activeKey = this.getActiveKey();
    const canonical = buildCanonicalActorPayload({
      actionScope: params.actionScope,
      targetId: params.targetId,
      operationMode: params.operationMode,
      actorUserId: params.actor.actorUserId,
      actorEmail: params.actor.actorEmail,
      actorRole: params.actor.actorRole,
      branchId: params.actor.branchId,
      employeeId: params.actor.employeeId,
      exp: params.exp,
      nonce: params.nonce,
    });

    const actorSig = computeActorHmacHex(canonical, activeKey.secret);

    return {
      keyId: activeKey.keyId,
      actionScope: params.actionScope,
      targetId: params.targetId.trim().toLowerCase(),
      operationMode: params.operationMode,
      actorUserId: params.actor.actorUserId.trim().toLowerCase(),
      actorEmail: params.actor.actorEmail.trim().toLowerCase(),
      actorRole: params.actor.actorRole,
      branchId: params.actor.branchId ? params.actor.branchId.trim().toLowerCase() : null,
      employeeId: params.actor.employeeId ? params.actor.employeeId.trim().toLowerCase() : null,
      exp: params.exp,
      nonce: params.nonce.trim().toLowerCase(),
      actorSig,
    };
  }

  /**
   * Local constant-time verifier matching database verification semantics
   * (rejects expired, TTL > 120s, revoked keys, and tampered fields).
   */
  verifyEnvelope(envelope: SignedActorEnvelope, nowEpoch: number): boolean {
    if (envelope.exp < nowEpoch || envelope.exp - nowEpoch > 120) {
      return false;
    }
    if (!/^[0-9a-f]{64}$/i.test(envelope.actorSig)) {
      return false;
    }

    const key = this.keys.get(envelope.keyId);
    if (!key || !key.isActive || key.revokedAt !== null) {
      return false;
    }

    const canonical = buildCanonicalActorPayload({
      actionScope: envelope.actionScope,
      targetId: envelope.targetId,
      operationMode: envelope.operationMode,
      actorUserId: envelope.actorUserId,
      actorEmail: envelope.actorEmail,
      actorRole: envelope.actorRole,
      branchId: envelope.branchId,
      employeeId: envelope.employeeId,
      exp: envelope.exp,
      nonce: envelope.nonce,
    });

    const expectedBuf = Buffer.from(computeActorHmacHex(canonical, key.secret), 'hex');
    const actualBuf = Buffer.from(envelope.actorSig.toLowerCase(), 'hex');
    return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
  }
}
