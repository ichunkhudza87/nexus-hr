import { createHmac, timingSafeEqual } from 'node:crypto';
import { GatewayError } from '../errors/gateway-error.ts';
import { CANONICAL_ACTOR_PAYLOAD_VERSION } from '../types/domain.ts';
import type {
  ActionScope,
  HmacSigningKeyRecord,
  OperationMode,
  ResolvedActor,
  SignedActorEnvelope,
} from '../types/domain.ts';

const KEY_ID_REGEX = /^[A-Za-z0-9._-]{1,64}$/;

export interface CanonicalPayloadInput {
  keyId: string;
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

export type LegacyV26CanonicalPayloadInput = Omit<CanonicalPayloadInput, 'keyId'>;

function assertValidKeyId(keyId: string): string {
  const trimmed = keyId.trim();
  if (!KEY_ID_REGEX.test(trimmed)) {
    throw new GatewayError(
      400,
      'INVALID_KEY',
      'HMAC keyId must match ^[A-Za-z0-9._-]{1,64}$ (pipe and whitespace characters prohibited).',
    );
  }
  return trimmed;
}

function sanitizeEmailField(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized || /[|\r\n\0]/.test(normalized)) {
    throw new GatewayError(400, 'INVALID_ACTOR_FIELD', 'Actor email contains prohibited control or delimiter characters.');
  }
  return normalized;
}

function isKeyActivated(key: HmacSigningKeyRecord, nowEpoch: number): boolean {
  const raw = key.activatedAt ?? key.createdAt;
  if (!raw) {
    return false;
  }
  const actMs = Date.parse(raw);
  if (Number.isNaN(actMs)) {
    return false;
  }
  return Math.floor(actMs / 1000) <= nowEpoch;
}

function isKeyUsable(key: HmacSigningKeyRecord, nowEpoch: number): boolean {
  return (
    key.isActive &&
    key.revokedAt === null &&
    isKeyActivated(key, nowEpoch) &&
    !isKeyExpired(key, nowEpoch)
  );
}

function isKeyExpired(key: HmacSigningKeyRecord, nowEpoch: number): boolean {
  if (!key.expiresAt) {
    return false;
  }
  const expMs = Date.parse(key.expiresAt);
  if (Number.isNaN(expMs)) {
    return true;
  }
  return Math.floor(expMs / 1000) <= nowEpoch;
}

/**
 * Builds the exact v2.7 canonical string (12 pipe-delimited fields) expected by
 * PostgreSQL nexus_internal.verify_gateway_actor() in SQL Remediation v2.7.
 *
 * Field order:
 *   v2.7 | key_id | action_scope | target_id | operation_mode | actor_user_id |
 *   actor_email | actor_role | branch_id | employee_id | exp | nonce
 *
 * Breaking contract update vs v2.6: prepends version tag 'v2.7' and key_id so the
 * selected signing key identity is cryptographically authenticated by both sides.
 */
export function buildCanonicalActorPayload(input: CanonicalPayloadInput): string {
  return [
    CANONICAL_ACTOR_PAYLOAD_VERSION,
    assertValidKeyId(input.keyId),
    input.actionScope,
    input.targetId.trim().toLowerCase(),
    input.operationMode,
    input.actorUserId.trim().toLowerCase(),
    sanitizeEmailField(input.actorEmail),
    input.actorRole,
    input.branchId ? input.branchId.trim().toLowerCase() : '',
    input.employeeId ? input.employeeId.trim().toLowerCase() : '',
    String(input.exp),
    input.nonce.trim().toLowerCase(),
  ].join('|');
}

/**
 * Deprecated Phase 3.12A v2.6 canonical string builder (10 fields, no version/keyId binding).
 * Retained strictly for compatibility documentation and regression tests proving v2.6
 * signatures are rejected under the v2.7 contract.
 */
export function buildCanonicalActorPayloadV26(input: LegacyV26CanonicalPayloadInput): string {
  return [
    input.actionScope,
    input.targetId.trim().toLowerCase(),
    input.operationMode,
    input.actorUserId.trim().toLowerCase(),
    sanitizeEmailField(input.actorEmail),
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

export interface RotateKeyOptions {
  keepPreviousValid?: boolean;
  gracePeriodSeconds?: number | null;
}

/**
 * Manages active HMAC signing keys with support for zero-downtime key rotation
 * (including bounded grace-period expiration) and immediate key revocation.
 */
export class ActorHmacSigner {
  private readonly keys = new Map<string, HmacSigningKeyRecord>();
  private readonly nowEpochFn: () => number;
  private activeKeyId: string;

  constructor(
    initialKeys: HmacSigningKeyRecord[],
    activeKeyId: string,
    options?: { nowEpochFn?: () => number },
  ) {
    if (initialKeys.length === 0) {
      throw new GatewayError(500, 'CONFIG_ERROR', 'At least one HMAC signing key is required.');
    }
    this.nowEpochFn = options?.nowEpochFn ?? (() => Math.floor(Date.now() / 1000));
    for (const k of initialKeys) {
      const normalizedId = assertValidKeyId(k.keyId);
      if (Buffer.byteLength(k.secret, 'utf8') < 32) {
        throw new GatewayError(500, 'CONFIG_ERROR', `HMAC key ${normalizedId} must be at least 32 bytes (256 bits).`);
      }
      const activatedAt = k.activatedAt ?? k.createdAt;
      if (!activatedAt || Number.isNaN(Date.parse(activatedAt))) {
        throw new GatewayError(500, 'CONFIG_ERROR', `HMAC key ${normalizedId} has invalid activatedAt timestamp.`);
      }
      this.keys.set(normalizedId, {
        ...k,
        keyId: normalizedId,
        activatedAt,
        expiresAt: k.expiresAt ?? null,
      });
    }
    this.activeKeyId = assertValidKeyId(activeKeyId);
    this.getActiveKey();
  }

  getActiveKeyId(): string {
    return this.activeKeyId;
  }

  listKeyMetadata(): Array<Omit<HmacSigningKeyRecord, 'secret'>> {
    return Array.from(this.keys.values()).map(({ secret: _secret, ...safe }) => safe);
  }

  getActiveKey(nowEpoch = this.nowEpochFn()): HmacSigningKeyRecord {
    const key = this.keys.get(this.activeKeyId);
    if (!key || !isKeyUsable(key, nowEpoch)) {
      throw new GatewayError(503, 'SIGNING_KEY_UNAVAILABLE', 'Active HMAC signing key is missing, not yet activated, expired, or revoked.');
    }
    return key;
  }

  /**
   * Registers a new active signing key and marks the previous key rotated
   * (optionally keeping the previous key valid during grace window until expiry/revocation).
   */
  rotateKey(
    newKeyId: string,
    newSecret: string,
    keepPreviousOrOptions: boolean | RotateKeyOptions = true,
  ): void {
    const opts: RotateKeyOptions =
      typeof keepPreviousOrOptions === 'boolean'
        ? { keepPreviousValid: keepPreviousOrOptions, gracePeriodSeconds: null }
        : keepPreviousOrOptions;
    const keepPreviousValid = opts.keepPreviousValid ?? true;
    const gracePeriodSeconds = opts.gracePeriodSeconds ?? null;

    const trimmedId = assertValidKeyId(newKeyId);
    if (this.keys.has(trimmedId)) {
      throw new GatewayError(409, 'KEY_ALREADY_EXISTS', `Signing key ${trimmedId} already exists.`);
    }
    if (Buffer.byteLength(newSecret, 'utf8') < 32) {
      throw new GatewayError(400, 'INVALID_KEY', 'Rotated HMAC key requires valid keyId and >=32-byte secret.');
    }
    if (gracePeriodSeconds !== null && (!Number.isInteger(gracePeriodSeconds) || gracePeriodSeconds < 1)) {
      throw new GatewayError(400, 'INVALID_KEY', 'gracePeriodSeconds must be a positive integer.');
    }

    const nowEpoch = this.nowEpochFn();
    const nowIso = new Date(nowEpoch * 1000).toISOString();
    const prev = this.keys.get(this.activeKeyId);
    if (prev) {
      prev.rotatedAt = nowIso;
      if (!keepPreviousValid) {
        prev.isActive = false;
        prev.revokedAt = nowIso;
      } else if (gracePeriodSeconds !== null) {
        prev.expiresAt = new Date((nowEpoch + gracePeriodSeconds) * 1000).toISOString();
      }
    }

    this.keys.set(trimmedId, {
      keyId: trimmedId,
      secret: newSecret,
      isActive: true,
      createdAt: nowIso,
      activatedAt: nowIso,
      rotatedAt: null,
      expiresAt: null,
      revokedAt: null,
    });
    this.activeKeyId = trimmedId;
  }

  /**
   * Immediately revokes a compromised or retired key ID.
   */
  revokeKey(keyId: string): void {
    const normalizedId = assertValidKeyId(keyId);
    const key = this.keys.get(normalizedId);
    if (!key) {
      throw new GatewayError(404, 'KEY_NOT_FOUND', `Signing key ${normalizedId} not found.`);
    }
    key.isActive = false;
    key.revokedAt = new Date(this.nowEpochFn() * 1000).toISOString();
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
    const normalizedEmail = sanitizeEmailField(params.actor.actorEmail);
    const canonical = buildCanonicalActorPayload({
      keyId: activeKey.keyId,
      actionScope: params.actionScope,
      targetId: params.targetId,
      operationMode: params.operationMode,
      actorUserId: params.actor.actorUserId,
      actorEmail: normalizedEmail,
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
      actorEmail: normalizedEmail,
      actorRole: params.actor.actorRole,
      branchId: params.actor.branchId ? params.actor.branchId.trim().toLowerCase() : null,
      employeeId: params.actor.employeeId ? params.actor.employeeId.trim().toLowerCase() : null,
      exp: params.exp,
      nonce: params.nonce.trim().toLowerCase(),
      actorSig,
    };
  }

  /**
   * Local constant-time verifier matching SQL v2.7 database verification semantics:
   * rejects expired envelopes, TTL > 120s, unknown/inactive/expired/revoked keys,
   * key substitution, and any canonical field tampering. Never falls back across keys.
   */
  verifyEnvelope(envelope: SignedActorEnvelope, nowEpoch = this.nowEpochFn()): boolean {
    if (!KEY_ID_REGEX.test(envelope.keyId?.trim() ?? '')) {
      return false;
    }
    if (envelope.exp < nowEpoch || envelope.exp - nowEpoch > 120) {
      return false;
    }
    if (!/^[0-9a-f]{64}$/i.test(envelope.actorSig)) {
      return false;
    }

    const key = this.keys.get(envelope.keyId.trim());
    if (!key || !isKeyUsable(key, nowEpoch)) {
      return false;
    }

    let canonical: string;
    try {
      canonical = buildCanonicalActorPayload({
        keyId: envelope.keyId,
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
    } catch {
      return false;
    }

    const expectedBuf = Buffer.from(computeActorHmacHex(canonical, key.secret), 'hex');
    const actualBuf = Buffer.from(envelope.actorSig.toLowerCase(), 'hex');
    return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
  }
}
