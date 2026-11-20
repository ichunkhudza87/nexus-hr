import { createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import type { JsonWebKey, KeyObject } from 'node:crypto';
import { GatewayError } from '../errors/gateway-error.ts';
import type { VerifiedJwtClaims } from '../types/domain.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_ASYMMETRIC_ALGS = new Set(['ES256', 'ES384', 'RS256', 'EdDSA']);

export interface JwkEntry extends JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
  kty: string;
}

export interface CentralJwtVerifierOptions {
  jwksUrl: string;
  expectedIssuer: string;
  expectedAudience: string;
  cacheTtlSeconds?: number;
  clockSkewSeconds?: number;
  requestTimeoutMs?: number;
  hs256Secret?: string;
  fetchFn?: typeof fetch;
  nowEpochFn?: () => number;
}

function decodeBase64UrlJson<T>(segment: string, label: string): T {
  try {
    const raw = Buffer.from(segment, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Non-object JSON');
    }
    return parsed as T;
  } catch {
    throw new GatewayError(401, 'INVALID_TOKEN', `Malformed JWT ${label}.`);
  }
}

export class CentralJwtVerifier {
  private readonly jwksUrl: string;
  private readonly expectedIssuer: string;
  private readonly expectedAudience: string;
  private readonly cacheTtlMs: number;
  private readonly clockSkewSeconds: number;
  private readonly requestTimeoutMs: number;
  private readonly hs256Secret: string | null;
  private readonly fetchFn: typeof fetch;
  private readonly nowEpochFn: () => number;

  private cachedKeys: JwkEntry[] = [];
  private cacheExpiresAtMs = 0;
  private lastRefreshAttemptMs = 0;

  constructor(options: CentralJwtVerifierOptions) {
    this.jwksUrl = options.jwksUrl;
    this.expectedIssuer = options.expectedIssuer.replace(/\/+$/, '');
    this.expectedAudience = options.expectedAudience;
    this.cacheTtlMs = (options.cacheTtlSeconds ?? 300) * 1000;
    this.clockSkewSeconds = options.clockSkewSeconds ?? 5;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 5000;
    this.hs256Secret = options.hs256Secret ?? null;
    this.fetchFn = options.fetchFn ?? fetch;
    this.nowEpochFn = options.nowEpochFn ?? (() => Math.floor(Date.now() / 1000));
  }

  async verifyToken(rawToken: string): Promise<VerifiedJwtClaims> {
    const token = rawToken.trim();
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      throw new GatewayError(401, 'INVALID_TOKEN', 'JWT must have exactly three segments.');
    }

    const [headerB64, payloadB64, signatureB64] = parts;
    const header = decodeBase64UrlJson<Record<string, unknown>>(headerB64, 'header');
    const payload = decodeBase64UrlJson<Record<string, unknown>>(payloadB64, 'payload');

    const alg = typeof header.alg === 'string' ? header.alg : '';
    const kid = typeof header.kid === 'string' ? header.kid : undefined;

    if (!alg || alg.toLowerCase() === 'none') {
      throw new GatewayError(401, 'INVALID_TOKEN', 'Unsigned or alg=none JWTs are rejected.');
    }

    const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
    const signature = Buffer.from(signatureB64, 'base64url');

    if (alg === 'HS256') {
      if (!this.hs256Secret) {
        throw new GatewayError(401, 'INVALID_TOKEN', 'Unsupported symmetric JWT algorithm.');
      }
      const expectedSig = createHmac('sha256', Buffer.from(this.hs256Secret, 'utf8'))
        .update(signingInput)
        .digest();
      if (expectedSig.length !== signature.length || !timingSafeEqual(expectedSig, signature)) {
        throw new GatewayError(401, 'INVALID_TOKEN', 'Invalid JWT signature.');
      }
    } else if (ALLOWED_ASYMMETRIC_ALGS.has(alg)) {
      const jwk = await this.resolveJwk(kid, alg);
      const valid = verifyAsymmetricSignature(alg, jwk, signingInput, signature);
      if (!valid) {
        throw new GatewayError(401, 'INVALID_TOKEN', 'Invalid JWT signature.');
      }
    } else {
      throw new GatewayError(401, 'INVALID_TOKEN', `Disallowed JWT algorithm: ${alg}.`);
    }

    return this.validateClaims(payload);
  }

  private validateClaims(payload: Record<string, unknown>): VerifiedJwtClaims {
    const now = this.nowEpochFn();

    const iss = typeof payload.iss === 'string' ? payload.iss.replace(/\/+$/, '') : '';
    if (iss !== this.expectedIssuer) {
      throw new GatewayError(401, 'INVALID_TOKEN', 'JWT issuer mismatch.');
    }

    const aud = payload.aud;
    const audValid =
      typeof aud === 'string'
        ? aud === this.expectedAudience
        : Array.isArray(aud) && aud.includes(this.expectedAudience);
    if (!audValid) {
      throw new GatewayError(401, 'INVALID_TOKEN', 'JWT audience mismatch.');
    }

    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      throw new GatewayError(401, 'INVALID_TOKEN', 'JWT missing valid exp claim.');
    }
    if (payload.exp <= now - this.clockSkewSeconds) {
      throw new GatewayError(401, 'TOKEN_EXPIRED', 'Central JWT has expired.');
    }

    if (payload.nbf !== undefined) {
      if (typeof payload.nbf !== 'number' || payload.nbf > now + this.clockSkewSeconds) {
        throw new GatewayError(401, 'TOKEN_NOT_ACTIVE', 'Central JWT is not yet active.');
      }
    }

    const sub = typeof payload.sub === 'string' ? payload.sub.trim().toLowerCase() : '';
    if (!UUID_REGEX.test(sub)) {
      throw new GatewayError(401, 'INVALID_TOKEN', 'JWT missing valid UUID sub claim.');
    }

    return {
      sub,
      email: typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : undefined,
      iss,
      aud: aud as string | string[],
      exp: payload.exp,
      iat: typeof payload.iat === 'number' ? payload.iat : undefined,
      nbf: typeof payload.nbf === 'number' ? payload.nbf : undefined,
      jti: typeof payload.jti === 'string' ? payload.jti : undefined,
    };
  }

  private async resolveJwk(kid: string | undefined, alg: string): Promise<JwkEntry> {
    const nowMs = Date.now();
    if (this.cachedKeys.length === 0 || nowMs >= this.cacheExpiresAtMs) {
      await this.refreshJwks();
    }

    let match = this.findMatchingKey(kid, alg);
    // Single forced refresh on unknown kid (handles Central key rotation), rate-limited to 10s
    if (!match && nowMs - this.lastRefreshAttemptMs > 10_000) {
      await this.refreshJwks();
      match = this.findMatchingKey(kid, alg);
    }

    if (!match) {
      throw new GatewayError(401, 'INVALID_TOKEN', 'No matching public JWK found for JWT.');
    }
    return match;
  }

  private findMatchingKey(kid: string | undefined, alg: string): JwkEntry | undefined {
    return this.cachedKeys.find((k) => {
      if (kid && k.kid && k.kid !== kid) {
        return false;
      }
      if (kid && !k.kid) {
        return false;
      }
      if (k.alg && k.alg !== alg) {
        return false;
      }
      if (k.use && k.use !== 'sig') {
        return false;
      }
      return isCompatibleKty(alg, k.kty);
    });
  }

  private async refreshJwks(): Promise<void> {
    this.lastRefreshAttemptMs = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const res = await this.fetchFn(this.jwksUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new GatewayError(503, 'JWKS_UNAVAILABLE', `Failed to fetch Central JWKS (${res.status}).`);
      }
      const body = (await res.json()) as { keys?: unknown };
      if (!body || !Array.isArray(body.keys)) {
        throw new GatewayError(503, 'JWKS_UNAVAILABLE', 'Malformed JWKS response.');
      }
      this.cachedKeys = body.keys.filter(
        (k): k is JwkEntry => Boolean(k && typeof k === 'object' && typeof (k as JwkEntry).kty === 'string'),
      );
      this.cacheExpiresAtMs = Date.now() + this.cacheTtlMs;
    } catch (err) {
      if (err instanceof GatewayError) {
        throw err;
      }
      throw new GatewayError(503, 'JWKS_UNAVAILABLE', 'Unable to reach Central JWKS endpoint.');
    } finally {
      clearTimeout(timer);
    }
  }
}

function isCompatibleKty(alg: string, kty: string): boolean {
  if (alg.startsWith('ES')) return kty === 'EC';
  if (alg.startsWith('RS')) return kty === 'RSA';
  if (alg === 'EdDSA') return kty === 'OKP';
  return false;
}

function verifyAsymmetricSignature(
  alg: string,
  jwk: JwkEntry,
  signingInput: Buffer,
  signature: Buffer,
): boolean {
  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey({ key: jwk, format: 'jwk' });
  } catch {
    return false;
  }

  if (alg === 'ES256') {
    return verify('sha256', signingInput, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature);
  }
  if (alg === 'ES384') {
    return verify('sha384', signingInput, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature);
  }
  if (alg === 'RS256') {
    return verify('RSA-SHA256', signingInput, publicKey, signature);
  }
  if (alg === 'EdDSA') {
    return verify(null, signingInput, publicKey, signature);
  }
  return false;
}

export function extractBearerToken(authorizationHeader: string | string[] | undefined): string {
  const raw = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
  if (!raw || typeof raw !== 'string') {
    throw new GatewayError(401, 'MISSING_TOKEN', 'Missing Authorization Bearer token.');
  }
  const match = /^Bearer\s+(\S+)$/i.exec(raw.trim());
  if (!match || !match[1]) {
    throw new GatewayError(401, 'MISSING_TOKEN', 'Authorization header must use Bearer scheme.');
  }
  return match[1];
}
