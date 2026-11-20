import { GatewayError } from '../errors/gateway-error.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER_REGEX = /(?:^|[_-])(your_|replace_with|changeme|placeholder)|_here$/i;

export interface SyncWorkerRuntimeConfig {
  centralSupabaseUrl: string;
  centralServiceRoleKey: string;
  branchASupabaseUrl: string;
  branchAServiceRoleKey: string;
  branchAId: string;
  workerId: string;
  batchSize: number;
  syncIntervalMs: number;
  syncEnabled: boolean;
  requestTimeoutMs: number;
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

/**
 * Loads and validates configuration specifically for the Distributed Sync Worker.
 *
 * Notice: DistributedSyncWorker interacts strictly via PostgREST to claim outbox rows
 * and project inbox events using service role keys. It does NOT sign HMAC actor envelopes,
 * therefore GATEWAY_ACTOR_HMAC_KEY is NOT required for worker processes.
 */
export function loadSyncWorkerConfig(
  env: Record<string, string | undefined> = process.env,
): SyncWorkerRuntimeConfig {
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

  const branchAId = (env.BRANCH_A_ID?.trim() || '00000000-0000-0000-0000-000000000001').toLowerCase();
  if (!UUID_REGEX.test(branchAId)) {
    throw new GatewayError(500, 'CONFIG_ERROR', 'BRANCH_A_ID must be a valid UUID.');
  }

  // Configurable worker identity with backward-compatible fallback
  const workerId = env.WORKER_ID?.trim() || 'worker-cli-branch-a';

  return {
    centralSupabaseUrl,
    centralServiceRoleKey,
    branchASupabaseUrl,
    branchAServiceRoleKey,
    branchAId,
    workerId,
    batchSize: parseIntBounded(env.SYNC_BATCH_SIZE, 10, 1, 1000, 'SYNC_BATCH_SIZE'),
    syncIntervalMs: parseIntBounded(env.SYNC_INTERVAL_MS, 5000, 200, 60000, 'SYNC_INTERVAL_MS'),
    syncEnabled: env.CENTRAL_SYNC_ENABLED !== 'false',
    requestTimeoutMs: parseIntBounded(env.SYNC_REQUEST_TIMEOUT_MS, 5000, 500, 30000, 'SYNC_REQUEST_TIMEOUT_MS'),
  };
}
