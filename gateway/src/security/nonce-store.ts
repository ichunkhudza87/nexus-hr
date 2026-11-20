import { randomUUID } from 'node:crypto';
import { GatewayError } from '../errors/gateway-error.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OUTBOUND_NAMESPACE = 'out';

/**
 * Process-local anti-replay store for:
 * 1) Outbound CSPRNG UUIDv4 actor nonces (authoritatively persisted & enforced
 *    across instances by PostgreSQL nexus_internal.used_actor_nonces).
 * 2) Best-effort, single-process local defense-in-depth for optional inbound
 *    X-Request-Nonce headers. NOTE: Inbound nonces are NOT shared across
 *    Gateway replicas or preserved across restarts.
 */
export class NonceStore {
  private readonly seenNonces = new Map<string, number>();
  private readonly nowEpochFn: () => number;
  private readonly uuidFn: () => string;
  private readonly maxEntries: number;
  private lastPrunedEpoch = -1;

  constructor(options?: {
    nowEpochFn?: () => number;
    uuidFn?: () => string;
    maxEntries?: number;
  }) {
    this.nowEpochFn = options?.nowEpochFn ?? (() => Math.floor(Date.now() / 1000));
    this.uuidFn = options?.uuidFn ?? randomUUID;
    this.maxEntries = options?.maxEntries ?? 100_000;
  }

  /**
   * Generates a fresh CSPRNG UUIDv4 nonce guaranteed not to collide with any
   * currently active outbound nonce in the local store.
   */
  issueOutboundNonce(ttlSeconds: number): { nonce: string; exp: number } {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 120) {
      throw new GatewayError(500, 'CONFIG_ERROR', 'Actor credential TTL must be 1..120 seconds.');
    }

    const now = this.nowEpochFn();
    this.pruneExpiredIfNeeded(now);

    const exp = now + ttlSeconds;
    const nonce = this.uuidFn().trim().toLowerCase();
    if (!UUID_REGEX.test(nonce)) {
      throw new GatewayError(500, 'NONCE_GENERATION_FAILED', 'Generated outbound nonce is not a valid UUID.');
    }

    const namespacedKey = `${OUTBOUND_NAMESPACE}:${nonce}`;
    const existingExp = this.seenNonces.get(namespacedKey);
    if (existingExp !== undefined && existingExp >= now) {
      throw new GatewayError(500, 'NONCE_COLLISION', 'CSPRNG outbound nonce collision detected.');
    }
    if (existingExp !== undefined) {
      this.seenNonces.delete(namespacedKey);
    }

    this.recordNonce(namespacedKey, exp, now);
    return { nonce, exp };
  }

  /**
   * Claims an inbound single-use nonce (e.g. X-Request-Nonce) in process memory
   * and throws 409 REPLAY_DETECTED if already observed before expiry.
   * Rejects attempts to access the internal 'out' namespace.
   */
  consumeInboundNonce(namespace: string, rawNonce: string, ttlSeconds = 300): void {
    const cleanNs = namespace.trim();
    if (!cleanNs || cleanNs.includes(':') || cleanNs === OUTBOUND_NAMESPACE) {
      throw new GatewayError(400, 'INVALID_NONCE', 'Invalid nonce namespace.');
    }

    const trimmed = rawNonce.trim().toLowerCase();
    if (!trimmed || (cleanNs === 'req' && !UUID_REGEX.test(trimmed))) {
      throw new GatewayError(400, 'INVALID_NONCE', 'X-Request-Nonce must be a valid UUID.');
    }

    const now = this.nowEpochFn();
    this.pruneExpiredIfNeeded(now);

    const key = `${cleanNs}:${trimmed}`;
    const existingExp = this.seenNonces.get(key);
    if (existingExp !== undefined && existingExp >= now) {
      throw new GatewayError(409, 'REPLAY_DETECTED', 'Replayed request credential rejected.');
    }
    if (existingExp !== undefined) {
      this.seenNonces.delete(key);
    }

    this.recordNonce(key, now + ttlSeconds, now);
  }

  size(): number {
    return this.seenNonces.size;
  }

  private recordNonce(key: string, expEpoch: number, nowEpoch: number): void {
    if (this.seenNonces.size >= this.maxEntries) {
      // Force full expired sweep before considering oldest-entry eviction
      this.pruneAllExpired(nowEpoch);
      if (this.seenNonces.size >= this.maxEntries) {
        const oldestKey = this.seenNonces.keys().next().value;
        if (oldestKey !== undefined) {
          this.seenNonces.delete(oldestKey);
        }
      }
    }
    this.seenNonces.set(key, expEpoch);
  }

  private pruneExpiredIfNeeded(nowEpoch: number): void {
    if (nowEpoch === this.lastPrunedEpoch) {
      return;
    }
    this.pruneAllExpired(nowEpoch);
    this.lastPrunedEpoch = nowEpoch;
  }

  private pruneAllExpired(nowEpoch: number): void {
    for (const [k, exp] of this.seenNonces.entries()) {
      if (exp < nowEpoch) {
        this.seenNonces.delete(k);
      }
    }
  }
}
