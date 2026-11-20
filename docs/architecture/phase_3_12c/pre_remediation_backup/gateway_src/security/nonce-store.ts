import { randomUUID } from 'node:crypto';
import { GatewayError } from '../errors/gateway-error.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tracks issued outbound actor nonces and optional inbound request nonces
 * with bounded TTL pruning to prevent replay attacks at the Gateway layer.
 */
export class NonceStore {
  private readonly seenNonces = new Map<string, number>();
  private readonly nowEpochFn: () => number;
  private readonly maxEntries: number;

  constructor(options?: { nowEpochFn?: () => number; maxEntries?: number }) {
    this.nowEpochFn = options?.nowEpochFn ?? (() => Math.floor(Date.now() / 1000));
    this.maxEntries = options?.maxEntries ?? 100_000;
  }

  /**
   * Generates a fresh CSPRNG UUIDv4 nonce guaranteed not to collide with any
   * currently active nonce in the local store.
   */
  issueOutboundNonce(ttlSeconds: number): { nonce: string; exp: number } {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 120) {
      throw new GatewayError(500, 'CONFIG_ERROR', 'Actor credential TTL must be 1..120 seconds.');
    }

    const now = this.nowEpochFn();
    this.pruneExpired(now);

    const exp = now + ttlSeconds;
    const nonce = randomUUID().toLowerCase();
    if (this.seenNonces.has(nonce)) {
      throw new GatewayError(500, 'NONCE_COLLISION', 'CSPRNG nonce collision detected.');
    }
    this.recordNonce(`out:${nonce}`, exp);
    return { nonce, exp };
  }

  /**
   * Claims an inbound single-use nonce (e.g. X-Request-Nonce or JWT jti)
   * and throws 409 REPLAY_DETECTED if already observed before expiry.
   */
  consumeInboundNonce(namespace: string, rawNonce: string, ttlSeconds = 300): void {
    const trimmed = rawNonce.trim().toLowerCase();
    if (!trimmed || (namespace === 'req' && !UUID_REGEX.test(trimmed))) {
      throw new GatewayError(400, 'INVALID_NONCE', 'X-Request-Nonce must be a valid UUID.');
    }

    const now = this.nowEpochFn();
    this.pruneExpired(now);

    const key = `${namespace}:${trimmed}`;
    const existingExp = this.seenNonces.get(key);
    if (existingExp !== undefined && existingExp >= now) {
      throw new GatewayError(409, 'REPLAY_DETECTED', 'Replayed request credential rejected.');
    }
    this.recordNonce(key, now + ttlSeconds);
  }

  size(): number {
    return this.seenNonces.size;
  }

  private recordNonce(key: string, expEpoch: number): void {
    if (this.seenNonces.size >= this.maxEntries) {
      const oldestKey = this.seenNonces.keys().next().value;
      if (oldestKey !== undefined) {
        this.seenNonces.delete(oldestKey);
      }
    }
    this.seenNonces.set(key, expEpoch);
  }

  private pruneExpired(nowEpoch: number): void {
    for (const [k, exp] of this.seenNonces.entries()) {
      if (exp < nowEpoch) {
        this.seenNonces.delete(k);
      }
    }
  }
}
