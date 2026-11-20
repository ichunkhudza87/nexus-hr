import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadSyncWorkerConfig } from '../sync/config.ts';
import { loadGatewayConfig } from '../config/env.ts';

function makeValidWorkerEnv(): Record<string, string> {
  return {
    SUPABASE_CENTRAL_URL: 'https://central.nexus-test.invalid',
    SUPABASE_CENTRAL_SERVICE_ROLE_KEY: 'srv_central_test_key_value_not_real_123456',
    SUPABASE_BRANCH_A_URL: 'https://branch.nexus-test.invalid',
    SUPABASE_BRANCH_A_SERVICE_ROLE_KEY: 'srv_branch_test_key_value_not_real_123456',
  };
}

describe('loadSyncWorkerConfig (Independent Worker Configuration)', () => {
  it('loads worker configuration without GATEWAY_ACTOR_HMAC_KEY', () => {
    const env = makeValidWorkerEnv();
    // Notice: GATEWAY_ACTOR_HMAC_KEY is completely omitted
    assert.equal(env.GATEWAY_ACTOR_HMAC_KEY, undefined);

    const cfg = loadSyncWorkerConfig(env);
    assert.equal(cfg.centralSupabaseUrl, 'https://central.nexus-test.invalid');
    assert.equal(cfg.branchASupabaseUrl, 'https://branch.nexus-test.invalid');
    assert.equal(cfg.workerId, 'worker-cli-branch-a');
    assert.equal(cfg.batchSize, 10);
    assert.equal(cfg.syncIntervalMs, 5000);
    assert.equal(cfg.syncEnabled, true);
    assert.equal(cfg.branchAId, '00000000-0000-0000-0000-000000000001');
  });

  it('supports configurable WORKER_ID through environment variables', () => {
    const env = {
      ...makeValidWorkerEnv(),
      WORKER_ID: 'render-worker-east-01',
    };
    const cfg = loadSyncWorkerConfig(env);
    assert.equal(cfg.workerId, 'render-worker-east-01');
  });

  it('supports custom batch size and polling interval within bounded limits', () => {
    const env = {
      ...makeValidWorkerEnv(),
      SYNC_BATCH_SIZE: '25',
      SYNC_INTERVAL_MS: '2000',
      CENTRAL_SYNC_ENABLED: 'false',
    };
    const cfg = loadSyncWorkerConfig(env);
    assert.equal(cfg.batchSize, 25);
    assert.equal(cfg.syncIntervalMs, 2000);
    assert.equal(cfg.syncEnabled, false);
  });

  it('fails closed on missing required database credentials', () => {
    const missingCentral = makeValidWorkerEnv();
    delete (missingCentral as Record<string, string | undefined>).SUPABASE_CENTRAL_SERVICE_ROLE_KEY;
    assert.throws(() => loadSyncWorkerConfig(missingCentral), /SUPABASE_CENTRAL_SERVICE_ROLE_KEY/);

    const missingBranch = makeValidWorkerEnv();
    delete (missingBranch as Record<string, string | undefined>).SUPABASE_BRANCH_A_URL;
    assert.throws(() => loadSyncWorkerConfig(missingBranch), /SUPABASE_BRANCH_A_URL/);
  });

  it('fails closed on placeholder database credentials', () => {
    const placeholder = makeValidWorkerEnv();
    placeholder.SUPABASE_CENTRAL_SERVICE_ROLE_KEY = 'your_central_service_role_key_here';
    assert.throws(() => loadSyncWorkerConfig(placeholder), /SUPABASE_CENTRAL_SERVICE_ROLE_KEY/);
  });

  it('enforces HTTPS or localhost URLs for Supabase endpoints', () => {
    const insecure = makeValidWorkerEnv();
    insecure.SUPABASE_BRANCH_A_URL = 'http://remote.untrusted.invalid';
    assert.throws(() => loadSyncWorkerConfig(insecure), /must use HTTPS/);
  });

  it('validates BRANCH_A_ID format', () => {
    const badUuid = {
      ...makeValidWorkerEnv(),
      BRANCH_A_ID: 'not-a-valid-uuid',
    };
    assert.throws(() => loadSyncWorkerConfig(badUuid), /BRANCH_A_ID must be a valid UUID/);
  });

  it('confirms Gateway continues requiring GATEWAY_ACTOR_HMAC_KEY while Worker does not', () => {
    const workerEnv = makeValidWorkerEnv();
    // Worker loads successfully
    assert.doesNotThrow(() => loadSyncWorkerConfig(workerEnv));

    // Gateway MUST reject the exact same env because it lacks HMAC signing credentials
    assert.throws(
      () => loadGatewayConfig(workerEnv),
      /GATEWAY_ACTOR_HMAC_KEY/,
    );
  });
});
