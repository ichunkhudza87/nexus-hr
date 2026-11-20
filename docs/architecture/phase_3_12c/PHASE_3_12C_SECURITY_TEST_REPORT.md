# NEXUS HR — PHASE 3.12C SECURITY TEST REPORT

**Phase:** 3.12C (Local Code Remediation & Testing Only)  
**Test Environment:** Local Node.js `v25.9.0` (`node --test`, `node --check`), local HTTP loopback (`127.0.0.1:0`), in-memory/local HTTP mocks.  
**Important Scope Notice:** No real Supabase project (`nexus-central`, `nexus-branch-a`) or remote PostgreSQL database was contacted. Live database integration remains **NOT VERIFIED** locally and is deferred to Phase 3.12D/Staging.

---

## 1. Execution Results Summary

### A. Static & Syntax Verification
- **Command:** `Get-ChildItem -Path "src" -Recurse -Filter "*.ts" | ForEach-Object { node --check $_.FullName }`
- **Files Checked:** `20` TypeScript source & test files under `gateway/src/`
- **Failures:** `0` (`SyntaxCheckCount=20 SyntaxFail=0`)
- **Tooling Gap Honesty Note:** Standalone `tsc` (`typescript`), `eslint`, and `psql` are **not installed** in the local environment, so full `tsc --noEmit` typechecking, ESLint rules, and live PostgreSQL parser execution could **not** be run locally (**NOT VERIFIED** by external compiler/DB parser).

### B. Automated Test Suite (`npm test`)
- **Command:** `Set-Location "D:\Antigravity_Projects\nexus-hr\gateway"; npm test` (`node --test src/__tests__/*.test.ts`)
- **Suites:** `6` passed, `0` failed
- **Tests:** **`32` total — `32` passed, `0` failed, `0` cancelled, `0` skipped, `0` todo**
- **Duration:** `1064.0176ms`

---

## 2. Classification by Verification Layer

### Category 1: Pure Unit Tests (16 Tests Passed)
1. **`CentralJwtVerifier` (7 tests — `src/__tests__/central-jwt.test.ts`):**
   - Verifies valid `ES256` & `RS256` Central JWTs.
   - Rejects expired tokens (`TOKEN_EXPIRED`).
   - Rejects `alg=none` unsigned JWT attacks.
   - Rejects `HS256` algorithm confusion attacks when expecting asymmetric JWKS.
   - Rejects wrong `iss`, wrong `aud`, and non-UUID `sub`.
   - Coalesces concurrent JWKS refreshes via single-flight lock (`fetchCount === 1` on initial concurrent calls; `fetchCount === 2` on concurrent unknown-`kid` rotation).
   - Verifies JWTs omitting `kid` across multiple compatible cached JWKs and fails closed (`503 JWKS_UNAVAILABLE`) when upstream JWKS errors.
2. **`loadGatewayConfig` (7 tests — `src/__tests__/env-config.test.ts`):**
   - Loads valid configuration and key rings cleanly.
   - Fails closed on missing or placeholder secrets (`your_`, `replace_with`, etc.).
   - Rejects HMAC secrets `< 32` UTF-8 bytes.
   - Rejects non-HTTPS non-localhost Supabase URLs.
   - Rejects `GATEWAY_ACTOR_TTL_SECONDS > 120`.
   - Parses JSON key rings with rotated/revoked keys (`GATEWAY_ACTOR_HMAC_KEYS_JSON`).
   - Rejects expired keys (`expiresAt` in past) and malformed `keyId`s containing `|`.
3. **`ActorHmacSigner & NonceStore` (4 tests — `src/__tests__/hmac-and-nonce.test.ts`):** *(2+2 logical areas counted in 4 `it()` specs)*
   - Exact v2.7 12-field canonical string & HMAC-SHA256 verification + explicit rejection of legacy v2.6 10-field signatures.
   - Detects `keyId` tampering, key selection mismatch (`gw-v2` vs `gw-v1`), unknown `keyId`, grace-period key expiry (`expiresAt`), `exp` expiration, `>120s` TTL, and actor/target field tampering.
   - Supports grace-period rotation, 10 concurrent signings under rotation, immediate key revocation (`revokeKey`), and active-key revocation fail-closed (`503 SIGNING_KEY_UNAVAILABLE`).
   - Verifies `B-4` `'out:'` collision detection, `out:` vs `req:` namespace isolation, `'out'` namespace injection blocking, expiry/pruning cleanup, and 50 concurrent CSPRNG outbound nonce generations.
4. **`IdentityResolver` (5 tests — `src/__tests__/identity-resolver.test.ts`):**
   - Active `BRANCH_MANAGER` with matching branch & active employee, `SUPERADMIN` without local employee row, missing/inactive Central profile fail-closed, branch mismatch/deactivated branch fail-closed, missing/inactive/deleted employee fail-closed.

### Category 2: Local HTTP Wire-Level Tests (4 Tests Passed — `src/__tests__/http-clients-wire.test.ts`)
Uses real `node:http` server bound to `127.0.0.1:0` (zero external network traffic):
1. `HttpCentralClient` exact REST path (`/rest/v1/user_profiles`), query filters, `apikey`, and `Bearer` `service_role` headers.
2. `HttpBranchAClient` `POST /rest/v1/rpc/rpc_branch_decide_leave_request` transmitting `p_key_id` and exact v2.7 RPC parameter names.
3. `HttpBranchAClient` `rpc_superadmin_update_leave_request` distinguishing omitted nullable fields (`p_set_rejection_reason: false`, `p_set_approved_by: false`, `p_set_approved_at: false`) vs explicit `null` clears (`p_set_*: true` + `null`) and carrying `p_key_id`.
4. `mapPostgrestError` SQLSTATE mappings (`42501`->403, `P0002`->404, `23514`->422, `55000`->503, 5xx redaction), `504` timeout (`AbortController`), `502` malformed HTTP 200 JSON, `502` upstream HTML error, `503` closed-port connection refusal, and zero secret/signature leakage in sanitized logs/errors.

### Category 3: Mocked DB Boundary E2E HTTP Gateway Tests (5 Tests Passed — `src/__tests__/leave-service-http.test.ts`)
Uses real local `createGatewayServer` HTTP listener + real `CentralJwtVerifier` + stateful in-memory `leave_requests` simulation:
1. Rejects forged `actor_id`, `actor_role`, `branch_id`, `approved_by`, `total_days`, `p_key_id`, `p_actor_email` (`400 FORBIDDEN_IDENTITY_FIELD`).
2. Blocks `EMPLOYEE` from calling `/decide` and `/admin` (`403`).
3. Issues verifiable HMAC envelopes for `BRANCH_MANAGER` (`X-Request-Nonce` replay -> `409`) and `SUPERADMIN`, with zero secret/JWT/signature leakage in JSON logs.
4. Exposes secret-free `/health`.
5. Exercises `SUPERADMIN` partial `CORRECTION` end-to-end: single-field update preserving existing `rejection_reason`/`approved_by`/`approved_at`, rejecting explicit `rejection_reason: null` when `REJECTED` (`422` + untouched DB/audit), rejecting `status: null` (`400`), allowing explicit clearing when transitioning back to `PENDING`, and rejecting `PENDING -> REJECTED` without `rejection_reason` (`422` + untouched DB/audit).

### Category 4: Live Database Integration Tests (**NOT VERIFIED LOCALLY**)
The following behaviors were reviewed statically in SQL v2.7 but **NOT executed** against live PostgreSQL 17 / PostgREST (prohibited in Phase 3.12C):
- PostgreSQL `extensions.hmac()` execution of SQL v2.7 `verify_gateway_actor()` against Gateway signatures.
- Live DB concurrency (`FOR UPDATE` row locks, `ON CONFLICT (nonce) DO NOTHING`, `cleanup_expired_actor_nonces` `SKIP LOCKED`).
- Real PostgREST RLS & `REVOKE UPDATE` behavior on `leave_requests` for `authenticated` JWTs.
- Rollback verification against remote schemas.
