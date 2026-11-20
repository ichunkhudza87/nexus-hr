# NEXUS HR — PHASE 4.1.1 SECURITY TEST RESULTS

**Test Runner:** Node.js native test runner (`node --test src/__tests__/*.test.ts`)  
**Workspace:** `D:\Antigravity_Projects\nexus-hr\gateway\`  
**Date:** 2026-11-12 (UTC+7)  
**Total Tests:** 40  
**Passed:** 40  
**Failed:** 0  
**Skipped / Cancelled:** 0  

---

## 1. Test Suite Breakdown

| Suite | File | Tests | Status | Scope |
|---|---|---|---|---|
| `CentralJwtVerifier` | `src/__tests__/central-jwt.test.ts` | 7 | **PASS** | Asymmetric ES256/RS256 JWT validation, `alg=none` rejection, `HS256` confusion prevention, `iss`/`aud`/`sub` checking, single-flight refresh & rotation. |
| `loadGatewayConfig` | `src/__tests__/env-config.test.ts` | 7 | **PASS** | Fail-closed env loading, placeholder rejection, `< 32`-byte secret rejection, non-HTTPS rejection, JSON key ring parsing, expired/pipe-keyId rejection. |
| `ActorHmacSigner & NonceStore` | `src/__tests__/hmac-and-nonce.test.ts` | 4 | **PASS** | v2.7 12-field canonical string parity with SQL v2.7, keyId/field tampering detection, grace-period rotation, CSPRNG collision & namespace isolation. |
| `HTTP Clients Wire-Level Tests` | `src/__tests__/http-clients-wire.test.ts` | 4 | **PASS** | Mock HTTP wire-level serialization, `p_key_id` RPC transport, tri-state flag serialization for `CORRECTION`, SQLSTATE mapping & error sanitization without secret leakage. |
| `IdentityResolver` | `src/__tests__/identity-resolver.test.ts` | 5 | **PASS** | Active `BRANCH_MANAGER` / `SUPERADMIN` resolution, inactive/missing Central profile fail-closed, branch mismatch fail-closed, employee missing/inactive/deleted fail-closed. |
| `Gateway HTTP & LeaveService E2E` | `src/__tests__/leave-service-http.test.ts` | 5 | **PASS** | Client-supplied actor/role tampering rejection, `EMPLOYEE` RBAC block on decision endpoints, verifiable HMAC envelope dispatch, secret-free `/health`, partial `CORRECTION` validation. |
| `Gateway HTTP Read Endpoints & CORS Hardening` | `src/__tests__/read-endpoints-http.test.ts` | 2 | **PASS** | CORS preflight `OPTIONS` (204) & origin allowlist enforcement (`403 CORS_FORBIDDEN`), role-isolated Central & Branch A read endpoints (`SUPERADMIN` vs `EMPLOYEE`), rejection of forbidden query parameters. |
| `SEC-41 Remediation & Security Hardening Tests` | `src/__tests__/sec-41-remediation.test.ts` | 6 | **PASS** | `activatedAt` future key rejection in `ActorHmacSigner` and `loadGatewayConfig`, envelope verification rejection for unactivated keys, sanitized `23505` and `23503` error messages without database schema leakage. |

---

## 2. Security Test Evidence Summary

1. **Future Key Activation Prevention:**
   - A key configured with `activatedAt = now + 3600` throws `503 SIGNING_KEY_UNAVAILABLE` upon `getActiveKey()`.
   - An envelope signed with a key whose `activatedAt` is in the future returns `false` during `verifyEnvelope()`.
2. **Database Constraint Information Leakage Prevention:**
   - Raw SQLSTATE `23505` error with message `duplicate key value violates unique constraint "uq_branches_code"` maps to HTTP `409 BUSINESS_RULE_VIOLATION` with client message `"A conflicting record already exists."`.
   - Raw SQLSTATE `23503` error with message `insert or update on table "leave_requests" violates foreign key constraint "fk_employee"` maps to HTTP `409 BUSINESS_RULE_VIOLATION` with client message `"Referenced record does not exist or cannot be linked."`.
3. **CORS Allowlist Enforcement:**
   - Preflight `OPTIONS` request from allowed origin `https://admin.nexus.local` responds with `204`, `Access-Control-Allow-Origin: https://admin.nexus.local`, and `Access-Control-Allow-Credentials: true`.
   - Request from disallowed origin `https://evil.local` responds with `403 CORS_FORBIDDEN`.
4. **Data Isolation by Role on Read Endpoints:**
   - `EMPLOYEE` role requesting `/api/employees` and `/api/leave-requests` is automatically constrained to their own `employee_id`.
   - Any query parameter attempting to inject authority (e.g. `?role=SUPERADMIN`) is rejected with HTTP `400 FORBIDDEN_IDENTITY_FIELD`.
