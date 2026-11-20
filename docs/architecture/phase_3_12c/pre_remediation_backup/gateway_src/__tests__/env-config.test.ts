import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadGatewayConfig } from '../config/env.ts';

function makeValidEnv(): Record<string, string> {
  return {
    SUPABASE_CENTRAL_URL: 'https://central.nexus-test.invalid',
    SUPABASE_CENTRAL_SERVICE_ROLE_KEY: 'srv_central_test_key_value_not_real_123456',
    SUPABASE_BRANCH_A_URL: 'https://branch.nexus-test.invalid',
    SUPABASE_BRANCH_A_SERVICE_ROLE_KEY: 'srv_branch_test_key_value_not_real_123456',
    GATEWAY_ACTOR_HMAC_KEY_ID: 'gw-hmac-v1',
    GATEWAY_ACTOR_HMAC_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    PORT: '4000',
  };
}

describe('loadGatewayConfig', () => {
  it('loads valid environment configuration cleanly', () => {
    const cfg = loadGatewayConfig(makeValidEnv());
    assert.equal(cfg.port, 4000);
    assert.equal(cfg.branchAId, '00000000-0000-0000-0000-000000000001');
    assert.equal(cfg.activeHmacKeyId, 'gw-hmac-v1');
    assert.equal(cfg.actorTtlSeconds, 60);
    assert.equal(cfg.hmacKeys.length, 1);
  });

  it('fails closed on missing or placeholder secrets', () => {
    const missing = makeValidEnv();
    delete missing.GATEWAY_ACTOR_HMAC_KEY;
    assert.throws(() => loadGatewayConfig(missing), /GATEWAY_ACTOR_HMAC_KEY/);

    const placeholder = makeValidEnv();
    placeholder.SUPABASE_BRANCH_A_SERVICE_ROLE_KEY = 'your_branch_a_service_role_key_here';
    assert.throws(() => loadGatewayConfig(placeholder), /SUPABASE_BRANCH_A_SERVICE_ROLE_KEY/);
  });

  it('rejects HMAC secrets shorter than 32 bytes', () => {
    const env = makeValidEnv();
    env.GATEWAY_ACTOR_HMAC_KEY = 'too_short_secret';
    assert.throws(() => loadGatewayConfig(env), /at least 32 bytes/);
  });

  it('rejects non-HTTPS URLs for non-localhost Supabase endpoints', () => {
    const env = makeValidEnv();
    env.SUPABASE_BRANCH_A_URL = 'http://branch.example.supabase.co';
    assert.throws(() => loadGatewayConfig(env), /must use HTTPS/);
  });

  it('rejects GATEWAY_ACTOR_TTL_SECONDS exceeding 120s SQL maximum', () => {
    const env = makeValidEnv();
    env.GATEWAY_ACTOR_TTL_SECONDS = '180';
    assert.throws(() => loadGatewayConfig(env), /between 5 and 120/);
  });

  it('supports JSON key ring with rotated and revoked keys', () => {
    const env = makeValidEnv();
    env.GATEWAY_ACTOR_HMAC_KEY_ID = 'gw-hmac-v2';
    env.GATEWAY_ACTOR_HMAC_KEYS_JSON = JSON.stringify([
      {
        keyId: 'gw-hmac-v1',
        secret: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        isActive: false,
        revokedAt: '2026-11-11T10:00:00Z',
      },
      {
        keyId: 'gw-hmac-v2',
        secret: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        isActive: true,
        revokedAt: null,
      },
    ]);
    const cfg = loadGatewayConfig(env);
    assert.equal(cfg.activeHmacKeyId, 'gw-hmac-v2');
    assert.equal(cfg.hmacKeys.length, 2);
  });
});
