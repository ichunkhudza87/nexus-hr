import { GatewayError } from '../errors/gateway-error.ts';
import type { HmacSigningKeyRecord } from '../types/domain.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_ID_REGEX = /^[A-Za-z0-9._-]{1,64}$/;
const PLACEHOLDER_REGEX = /(?:^|[_-])(your_|replace_with|changeme|placeholder)|_here$/i;

export interface GatewayConfig {
  port: number;
  centralSupabaseUrl: string;
  centralServiceRoleKey: string;
  centralJwksUrl: string;
  centralJwtIssuer: string;
  centralJwtAudience: string;
  jwksCacheTtlSeconds: number;
  jwtClockSkewSeconds: number;
  branchASupabaseUrl: string;
  branchAServiceRoleKey: string;
  branchAId: string;
  branchACode: string;
  hmacKeys: HmacSigningKeyRecord[];
  activeHmacKeyId: string;
  actorTtlSeconds: number;
  requestTimeoutMs: number;
  corsAllowedOrigins: string[];
}

function requireNonEmptyEnv(env: Record<string, string | undefined>, name: string): string {
  const val = env[name]?.trim();
  if (!val || PLACEHOLDER_REGEX.test(val)) {
    throw new GatewayError(500, 'CONFIG_ERROR', `Missing or placeholder environment variable: ${name}`);
  }
  return val;
}

function requireHttpsOrLocalUrl(raw: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new GatewayError(500, 'CONFIG_ERROR', `Invalid URL in ${name}`);
  }
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocal)) {
    throw new GatewayError(500, 'CONFIG_ERROR', `${name} must use HTTPS (or HTTP on localhost only).`);
  }
  return raw.replace(/\/+$/, '');
}

function assertValidHmacSecret(secret: string, keyId: string): void {
  if (PLACEHOLDER_REGEX.test(secret)) {
    throw new GatewayError(500, 'CONFIG_ERROR', `HMAC secret for keyId ${keyId} contains placeholder text.`);
  }
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new GatewayError(
      500,
      'CONFIG_ERROR',
      `HMAC secret for keyId ${keyId} must be at least 32 bytes (256 bits).`,
    );
  }
}

function parseIntBounded(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (!raw || raw.trim() === '') {
    return fallback;
  }
  const num = Number(raw);
  if (!Number.isInteger(num) || num < min || num > max) {
    throw new GatewayError(500, 'CONFIG_ERROR', `${name} must be an integer between ${min} and ${max}.`);
  }
  return num;
}

function loadHmacKeyRing(env: Record<string, string | undefined>): {
  hmacKeys: HmacSigningKeyRecord[];
  activeHmacKeyId: string;
} {
  const ringJson = env.GATEWAY_ACTOR_HMAC_KEYS_JSON?.trim();
  if (ringJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(ringJson);
    } catch {
      throw new GatewayError(500, 'CONFIG_ERROR', 'GATEWAY_ACTOR_HMAC_KEYS_JSON is invalid JSON.');
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new GatewayError(500, 'CONFIG_ERROR', 'GATEWAY_ACTOR_HMAC_KEYS_JSON must be a non-empty array.');
    }

    const keys: HmacSigningKeyRecord[] = parsed.map((entry, idx) => {
      if (!entry || typeof entry !== 'object') {
        throw new GatewayError(500, 'CONFIG_ERROR', `Invalid key entry at index ${idx}.`);
      }
      const rec = entry as Record<string, unknown>;
      const keyId = typeof rec.keyId === 'string' ? rec.keyId.trim() : '';
      const secret = typeof rec.secret === 'string' ? rec.secret.trim() : '';
      if (!keyId || !KEY_ID_REGEX.test(keyId) || !secret) {
        throw new GatewayError(500, 'CONFIG_ERROR', `Invalid keyId or missing secret at index ${idx}.`);
      }
      assertValidHmacSecret(secret, keyId);
      const createdAt = typeof rec.createdAt === 'string' ? rec.createdAt : new Date().toISOString();
      const activatedAt = typeof rec.activatedAt === 'string' ? rec.activatedAt : createdAt;
      if (Number.isNaN(Date.parse(activatedAt))) {
        throw new GatewayError(500, 'CONFIG_ERROR', `Invalid activatedAt timestamp for keyId ${keyId}.`);
      }
      let expiresAt: string | null = null;
      if (rec.expiresAt !== undefined && rec.expiresAt !== null) {
        if (typeof rec.expiresAt !== 'string' || Number.isNaN(Date.parse(rec.expiresAt))) {
          throw new GatewayError(500, 'CONFIG_ERROR', `Invalid expiresAt timestamp for keyId ${keyId}.`);
        }
        expiresAt = rec.expiresAt;
      }
      const nowMs = Date.now();
      const isActivated = Date.parse(activatedAt) <= nowMs;
      const isExpired = expiresAt !== null && Date.parse(expiresAt) <= nowMs;
      return {
        keyId,
        secret,
        isActive: rec.isActive !== false && rec.revokedAt == null && isActivated && !isExpired,
        createdAt,
        activatedAt,
        rotatedAt: typeof rec.rotatedAt === 'string' ? rec.rotatedAt : null,
        expiresAt,
        revokedAt: typeof rec.revokedAt === 'string' ? rec.revokedAt : null,
      };
    });

    const preferredId = env.GATEWAY_ACTOR_HMAC_KEY_ID?.trim();
    if (preferredId && !KEY_ID_REGEX.test(preferredId)) {
      throw new GatewayError(500, 'CONFIG_ERROR', 'GATEWAY_ACTOR_HMAC_KEY_ID has invalid format.');
    }
    const isUsable = (k: HmacSigningKeyRecord) => {
      const nowMs = Date.now();
      const activatedMs = k.activatedAt ? Date.parse(k.activatedAt) : NaN;
      const isActivated = !Number.isNaN(activatedMs) && activatedMs <= nowMs;
      const isNotExpired = !k.expiresAt || Date.parse(k.expiresAt) > nowMs;
      return k.isActive && k.revokedAt === null && isActivated && isNotExpired;
    };
    const active = preferredId
      ? keys.find((k) => k.keyId === preferredId && isUsable(k))
      : keys.find(isUsable);

    if (!active) {
      throw new GatewayError(500, 'CONFIG_ERROR', 'No active non-revoked HMAC key available in key ring.');
    }

    return { hmacKeys: keys, activeHmacKeyId: active.keyId };
  }

  const keyId = env.GATEWAY_ACTOR_HMAC_KEY_ID?.trim() || 'gw-hmac-v1';
  if (!KEY_ID_REGEX.test(keyId)) {
    throw new GatewayError(500, 'CONFIG_ERROR', 'GATEWAY_ACTOR_HMAC_KEY_ID has invalid format.');
  }
  const secret = requireNonEmptyEnv(env, 'GATEWAY_ACTOR_HMAC_KEY');
  assertValidHmacSecret(secret, keyId);
  const nowIso = new Date().toISOString();

  return {
    hmacKeys: [
      {
        keyId,
        secret,
        isActive: true,
        createdAt: nowIso,
        activatedAt: nowIso,
        rotatedAt: null,
        expiresAt: null,
        revokedAt: null,
      },
    ],
    activeHmacKeyId: keyId,
  };
}

export function loadGatewayConfig(
  env: Record<string, string | undefined> = process.env,
): GatewayConfig {
  const centralSupabaseUrl = requireHttpsOrLocalUrl(
    requireNonEmptyEnv(env, 'SUPABASE_CENTRAL_URL'),
    'SUPABASE_CENTRAL_URL',
  );
  const centralServiceRoleKey = requireNonEmptyEnv(env, 'SUPABASE_CENTRAL_SERVICE_ROLE_KEY');

  const branchASupabaseUrl = requireHttpsOrLocalUrl(
    requireNonEmptyEnv(env, 'SUPABASE_BRANCH_A_URL'),
    'SUPABASE_BRANCH_A_URL',
  );
  const branchAServiceRoleKey = requireNonEmptyEnv(env, 'SUPABASE_BRANCH_A_SERVICE_ROLE_KEY');

  const centralJwksUrl = requireHttpsOrLocalUrl(
    env.CENTRAL_JWKS_URL?.trim() || `${centralSupabaseUrl}/auth/v1/.well-known/jwks.json`,
    'CENTRAL_JWKS_URL',
  );
  const centralJwtIssuer = (
    env.CENTRAL_JWT_ISSUER?.trim() || `${centralSupabaseUrl}/auth/v1`
  ).replace(/\/+$/, '');
  const centralJwtAudience = env.CENTRAL_JWT_AUDIENCE?.trim() || 'authenticated';

  const branchAId = (env.BRANCH_A_ID?.trim() || '00000000-0000-0000-0000-000000000001').toLowerCase();
  if (!UUID_REGEX.test(branchAId)) {
    throw new GatewayError(500, 'CONFIG_ERROR', 'BRANCH_A_ID must be a valid UUID.');
  }
  const branchACode = env.BRANCH_A_CODE?.trim() || 'BRANCH-A';

  const { hmacKeys, activeHmacKeyId } = loadHmacKeyRing(env);

  return {
    port: parseIntBounded(env.PORT, 3000, 1, 65535, 'PORT'),
    centralSupabaseUrl,
    centralServiceRoleKey,
    centralJwksUrl,
    centralJwtIssuer,
    centralJwtAudience,
    jwksCacheTtlSeconds: parseIntBounded(env.JWKS_CACHE_TTL_SECONDS, 300, 10, 3600, 'JWKS_CACHE_TTL_SECONDS'),
    jwtClockSkewSeconds: parseIntBounded(env.JWT_CLOCK_SKEW_SECONDS, 5, 0, 30, 'JWT_CLOCK_SKEW_SECONDS'),
    branchASupabaseUrl,
    branchAServiceRoleKey,
    branchAId,
    branchACode,
    hmacKeys,
    activeHmacKeyId,
    // SQL verify_gateway_actor() rejects TTL > 120 seconds
    actorTtlSeconds: parseIntBounded(env.GATEWAY_ACTOR_TTL_SECONDS, 60, 5, 120, 'GATEWAY_ACTOR_TTL_SECONDS'),
    requestTimeoutMs: parseIntBounded(env.GATEWAY_REQUEST_TIMEOUT_MS, 5000, 500, 30000, 'GATEWAY_REQUEST_TIMEOUT_MS'),
    corsAllowedOrigins: (env.CORS_ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '' && s !== '*'),
  };
}
