import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { describe, it } from 'node:test';
import { CentralJwtVerifier } from '../auth/central-jwt.ts';
import type { JwkEntry } from '../auth/central-jwt.ts';

function signEs256Jwt(
  payload: Record<string, unknown>,
  privateKey: KeyObject,
  kid = 'key-ec-1',
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = sign('sha256', Buffer.from(`${header}.${body}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `${header}.${body}.${sig}`;
}

function signRs256Jwt(
  payload: Record<string, unknown>,
  privateKey: KeyObject,
  kid = 'key-rsa-1',
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = sign('RSA-SHA256', Buffer.from(`${header}.${body}`), privateKey).toString('base64url');
  return `${header}.${body}.${sig}`;
}

describe('CentralJwtVerifier', () => {
  const ecPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const ecJwk = {
    ...(ecPair.publicKey.export({ format: 'jwk' }) as JwkEntry),
    kid: 'key-ec-1',
    use: 'sig',
    alg: 'ES256',
  };

  const rsaPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rsaJwk = {
    ...(rsaPair.publicKey.export({ format: 'jwk' }) as JwkEntry),
    kid: 'key-rsa-1',
    use: 'sig',
    alg: 'RS256',
  };

  const now = 1_800_000_000;
  const issuer = 'https://central.example.supabase.co/auth/v1';

  function makeVerifier(keys: JwkEntry[] = [ecJwk, rsaJwk]) {
    const fetchMock: typeof fetch = async () =>
      new Response(JSON.stringify({ keys }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    return new CentralJwtVerifier({
      jwksUrl: `${issuer}/.well-known/jwks.json`,
      expectedIssuer: issuer,
      expectedAudience: 'authenticated',
      nowEpochFn: () => now,
      fetchFn: fetchMock,
    });
  }

  it('verifies valid ES256 and RS256 Central JWTs', async () => {
    const verifier = makeVerifier();
    const baseClaims = {
      sub: 'A1B2C3D4-E5F6-4789-ABCD-0123456789EF',
      email: 'Manager@Nexus.local',
      iss: issuer,
      aud: 'authenticated',
      exp: now + 300,
    };

    const ecClaims = await verifier.verifyToken(signEs256Jwt(baseClaims, ecPair.privateKey));
    assert.equal(ecClaims.sub, 'a1b2c3d4-e5f6-4789-abcd-0123456789ef');
    assert.equal(ecClaims.email, 'manager@nexus.local');

    const rsaClaims = await verifier.verifyToken(signRs256Jwt(baseClaims, rsaPair.privateKey));
    assert.equal(rsaClaims.sub, 'a1b2c3d4-e5f6-4789-abcd-0123456789ef');
  });

  it('rejects expired tokens', async () => {
    const verifier = makeVerifier();
    const token = signEs256Jwt(
      {
        sub: 'a1b2c3d4-e5f6-4789-abcd-0123456789ef',
        iss: issuer,
        aud: 'authenticated',
        exp: now - 30,
      },
      ecPair.privateKey,
    );
    await assert.rejects(() => verifier.verifyToken(token), /expired/i);
  });

  it('rejects alg=none unsigned JWT attacks', async () => {
    const verifier = makeVerifier();
    const h = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(
      JSON.stringify({
        sub: 'a1b2c3d4-e5f6-4789-abcd-0123456789ef',
        iss: issuer,
        aud: 'authenticated',
        exp: now + 300,
      }),
    ).toString('base64url');
    await assert.rejects(() => verifier.verifyToken(`${h}.${p}.sig`), /alg=none/);
  });

  it('rejects HS256 algorithm confusion attacks when verifier expects asymmetric JWKS', async () => {
    const verifier = makeVerifier();
    const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'key-ec-1' })).toString('base64url');
    const p = Buffer.from(
      JSON.stringify({
        sub: 'a1b2c3d4-e5f6-4789-abcd-0123456789ef',
        iss: issuer,
        aud: 'authenticated',
        exp: now + 300,
      }),
    ).toString('base64url');
    const s = createHmac('sha256', JSON.stringify(ecJwk)).update(`${h}.${p}`).digest('base64url');
    await assert.rejects(() => verifier.verifyToken(`${h}.${p}.${s}`), /Unsupported symmetric JWT/);
  });

  it('rejects wrong issuer, wrong audience, and non-UUID sub', async () => {
    const verifier = makeVerifier();

    const wrongIss = signEs256Jwt(
      { sub: 'a1b2c3d4-e5f6-4789-abcd-0123456789ef', iss: 'https://evil.example', aud: 'authenticated', exp: now + 60 },
      ecPair.privateKey,
    );
    await assert.rejects(() => verifier.verifyToken(wrongIss), /issuer mismatch/);

    const wrongAud = signEs256Jwt(
      { sub: 'a1b2c3d4-e5f6-4789-abcd-0123456789ef', iss: issuer, aud: 'service_role', exp: now + 60 },
      ecPair.privateKey,
    );
    await assert.rejects(() => verifier.verifyToken(wrongAud), /audience mismatch/);

    const badSub = signEs256Jwt(
      { sub: 'not-a-uuid', iss: issuer, aud: 'authenticated', exp: now + 60 },
      ecPair.privateKey,
    );
    await assert.rejects(() => verifier.verifyToken(badSub), /UUID sub/);
  });

  it('coalesces concurrent JWKS refreshes via single-flight lock and handles unknown-kid rotation', async () => {
    const ecPair2 = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const ecJwk2 = {
      ...(ecPair2.publicKey.export({ format: 'jwk' }) as JwkEntry),
      kid: 'key-ec-2',
      use: 'sig',
      alg: 'ES256',
    };

    let fetchCount = 0;
    let activeKeys: JwkEntry[] = [ecJwk];
    const verifier = new CentralJwtVerifier({
      jwksUrl: `${issuer}/.well-known/jwks.json`,
      expectedIssuer: issuer,
      expectedAudience: 'authenticated',
      nowEpochFn: () => now,
      fetchFn: async () => {
        fetchCount += 1;
        await new Promise((r) => setTimeout(r, 15));
        return new Response(JSON.stringify({ keys: activeKeys }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    const token1 = signEs256Jwt(
      { sub: 'a1b2c3d4-e5f6-4789-abcd-0123456789ef', iss: issuer, aud: 'authenticated', exp: now + 60 },
      ecPair.privateKey,
      'key-ec-1',
    );
    await Promise.all([verifier.verifyToken(token1), verifier.verifyToken(token1), verifier.verifyToken(token1)]);
    assert.equal(fetchCount, 1);

    // Rotate IdP key to key-ec-2; concurrent requests trigger exactly 1 forced JWKS refresh
    activeKeys = [ecJwk, ecJwk2];
    const token2 = signEs256Jwt(
      { sub: 'a1b2c3d4-e5f6-4789-abcd-0123456789ef', iss: issuer, aud: 'authenticated', exp: now + 60 },
      ecPair2.privateKey,
      'key-ec-2',
    );
    await Promise.all([verifier.verifyToken(token2), verifier.verifyToken(token2)]);
    assert.equal(fetchCount, 2);
  });

  it('verifies JWTs with omitted kid across multiple matching JWKs and fails closed on 503 JWKS outage', async () => {
    const ecPair2 = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const ecJwk2 = {
      ...(ecPair2.publicKey.export({ format: 'jwk' }) as JwkEntry),
      kid: 'key-ec-2',
      use: 'sig',
      alg: 'ES256',
    };

    let failUpstream = false;
    const verifier = new CentralJwtVerifier({
      jwksUrl: `${issuer}/.well-known/jwks.json`,
      expectedIssuer: issuer,
      expectedAudience: 'authenticated',
      nowEpochFn: () => now,
      fetchFn: async () => {
        if (failUpstream) {
          return new Response('upstream error', { status: 500 });
        }
        return new Response(JSON.stringify({ keys: [ecJwk, ecJwk2] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    // JWT signed with second EC key, omitting kid in header
    const hNoKid = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(
      JSON.stringify({
        sub: 'a1b2c3d4-e5f6-4789-abcd-0123456789ef',
        iss: issuer,
        aud: 'authenticated',
        exp: now + 60,
      }),
    ).toString('base64url');
    const sig2 = sign('sha256', Buffer.from(`${hNoKid}.${p}`), {
      key: ecPair2.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url');

    const verified = await verifier.verifyToken(`${hNoKid}.${p}.${sig2}`);
    assert.equal(verified.sub, 'a1b2c3d4-e5f6-4789-abcd-0123456789ef');

    // Upstream JWKS unavailable fails closed with 503 JWKS_UNAVAILABLE
    const outageVerifier = new CentralJwtVerifier({
      jwksUrl: `${issuer}/.well-known/jwks.json`,
      expectedIssuer: issuer,
      expectedAudience: 'authenticated',
      nowEpochFn: () => now,
      fetchFn: async () => new Response('down', { status: 502 }),
    });
    await assert.rejects(() => outageVerifier.verifyToken(`${hNoKid}.${p}.${sig2}`), /Failed to fetch Central JWKS/);
  });
});
