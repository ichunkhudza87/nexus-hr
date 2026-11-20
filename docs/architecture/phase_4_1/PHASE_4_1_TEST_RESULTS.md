# NEXUS HR — PHASE 4.1 TEST RESULTS

**Test Command:** `Set-Location -Path "D:\Antigravity_Projects\nexus-hr\gateway"; npm test` (`node --test src/__tests__/*.test.ts`)  
**Execution Date:** 2026-11-12 (UTC+7)  
**Scope:** Local unit, wire-level mock HTTP, and end-to-end Gateway HTTP security tests (no remote database connections).

---

## 1. Test Execution Summary

- **Total Suites:** 6
- **Total Tests:** 32
- **Passed:** 32
- **Failed:** 0
- **Skipped / Cancelled:** 0

| Suite | File | Tests | Result | Verified Coverage |
|---|---|---|---|---|
| `CentralJwtVerifier` | `src/__tests__/central-jwt.test.ts` | 7 | **PASS** | ES256/RS256 verification, expired token rejection, `alg=none` rejection, `HS256` confusion rejection, `iss`/`aud`/`sub` validation, single-flight JWKS refresh & `kid` rotation, omitted `kid` & 503 JWKS outage fail-closed. |
| `loadGatewayConfig` | `src/__tests__/env-config.test.ts` | 7 | **PASS** | Valid config loading, missing/placeholder secret rejection, `<32`-byte HMAC rejection, non-HTTPS remote URL rejection, `TTL > 120s` rejection, JSON key ring with rotated/revoked keys, expired/pipe-`keyId` rejection. |
| `ActorHmacSigner & NonceStore` | `src/__tests__/hmac-and-nonce.test.ts` | 4 | **PASS** | v2.7 12-field canonical payload parity, `keyId`/field tampering & expired/unknown key detection, grace-period rotation & immediate revocation, CSPRNG collision detection & `out:`/`req:` namespace isolation. |
| `HTTP Clients Wire-Level Tests` | `src/__tests__/http-clients-wire.test.ts` | 4 | **PASS** | `HttpCentralClient` REST query & `service_role` headers, `HttpBranchAClient` `p_key_id` + `decideLeaveRequest` RPC wire format, omitted vs explicit `null` `CORRECTION` tri-state flags, SQLSTATE mapping (`42501`, `P0002`, `23514`, `55000`) & network/timeout/malformed JSON handling without secret leakage. |
| `IdentityResolver` | `src/__tests__/identity-resolver.test.ts` | 5 | **PASS** | Active `BRANCH_MANAGER` resolution, `SUPERADMIN` without Branch A employee row, missing/inactive Central profile fail-closed, branch mismatch/inactive fail-closed, missing/inactive/deleted `BRANCH_MANAGER` employee fail-closed. |
| `Gateway HTTP & LeaveService E2E` | `src/__tests__/leave-service-http.test.ts` | 5 | **PASS** | Rejection of client-supplied `actor_id`/`actor_role`/`branch_id` & field tampering, `EMPLOYEE` role RBAC block, verifiable HMAC envelope emission without log secret leakage, secret-free `/health`, partial `CORRECTION` with omitted vs invalid explicit nulls. |

---

## 2. Coverage Gaps Identified for Phase 4.2

1. **Future `activatedAt` Key Rejection:** Add test cases verifying future `activatedAt` keys are rejected in `loadHmacKeyRing` and `ActorHmacSigner` once implemented (`SEC-41-01`).
2. **Sanitized Constraint Error Messages:** Add test cases verifying `23505`/`23503` constraint errors do not leak raw PostgreSQL constraint/table names (`SEC-41-02`).
3. **New Domain Read/Write Routes:** Add unit & HTTP tests for `employee_directory`, `attendance_daily_summaries`, `shifts`, `employee_schedules`, `attendance`, and `leave_requests` GET routes when implemented in Phase 4.2.
4. **TypeScript Compiler Check:** `typescript` (`tsc`) is not installed in `gateway` (Node 22+ runs `.ts` natively); consider adding `typescript` as a devDependency or CI typecheck if strict build-time verification is desired.
