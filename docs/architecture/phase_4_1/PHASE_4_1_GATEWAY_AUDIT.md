# NEXUS HR — PHASE 4.1 GATEWAY AUDIT

**Workspace:** `D:\Antigravity_Projects\nexus-hr\gateway\`  
**Audit Date:** 2026-11-12 (UTC+7)  
**Mode:** Read-Only Source Inspection + Local Mocked Test Execution  
**Classification:** **`READY WITH REMEDIATION — LOCAL FIXES REQUIRED`**

---

## 1. Module-by-Module Audit Summary

| Module | File | Status | Findings / Notes |
|---|---|---|---|
| HTTP App & Routing | `src/app.ts` | Partial / Good | Implements `GET /health`, `POST /api/v1/leave-requests/:id/decide`, `PATCH /api/v1/admin/leave-requests/:id`; 64 KB body limit; `no-store` & `nosniff` headers. Missing CORS handling & read/attendance/schedule routes. |
| Entrypoint | `src/index.ts` | Needs Hardening | Wires all dependencies cleanly; lacks `server.requestTimeout`/`headersTimeout` and `SIGINT`/`SIGTERM` graceful shutdown. |
| Central JWT Verifier | `src/auth/central-jwt.ts` | Verified | Asymmetric JWKS (`ES256`, `ES384`, `RS256`, `EdDSA`); rejects `alg=none` and `HS256` (when secret unset); single-flight JWKS refresh lock + unknown-`kid` 10s throttle; `iss`/`aud`/`exp`/`nbf`/`sub` UUID checks. |
| Identity Resolver | `src/auth/identity-resolver.ts` | Verified | Queries Central `user_profiles` + `branches` via `claims.sub`; enforces `is_active`, role allowlist, `BRANCH-A` match for non-enterprise roles, and active non-deleted Branch A `employees` row. |
| HMAC v2.7 Signer | `src/security/hmac-signer.ts` | Minor Gap | Exact 12-field v2.7 canonical string (`v2.7\|key_id\|...\|nonce`); supports grace-period rotation, `expiresAt`, `revokedAt`, constant-time `verifyEnvelope`. **Gap:** `activatedAt` is stored but not enforced (`activatedAt > now` not rejected). |
| Nonce Store | `src/security/nonce-store.ts` | Verified | CSPRNG UUIDv4 outbound nonces (`out:` namespace, 1..120s TTL), isolated inbound `X-Request-Nonce` (`req:` namespace), bounded `maxEntries = 100_000` with expired sweep. Authoritative cross-instance replay protection is enforced in DB `nexus_internal.used_actor_nonces`. |
| Central DB Client | `src/clients/central-client.ts` | Partial | `getUserProfileWithBranch` implemented with `service_role` headers, timeout, array-length check. Missing `employee_directory` and `attendance_daily_summaries` read methods. |
| Branch A RPC Client | `src/clients/branch-rpc-client.ts` | Partial / Verified | `getEmployeesByAuthId`, `decideLeaveRequest`, `superadminUpdateLeaveRequest` match SQL v2.7.1 signatures exactly (including `p_key_id` and tri-state flags). Missing `shifts`, `employee_schedules`, `attendance`, and `leave_requests` read methods. |
| Leave Service | `src/services/leave-service.ts` | Verified | Enforces role boundaries (`BRANCH_MANAGER` vs `SUPERADMIN`), issues outbound nonce + v2.7 HMAC envelope, dispatches RPC. |
| Request Validation | `src/validation/leave-schemas.ts` | Verified | Strict allowlists + `FORBIDDEN_ACTOR_KEYS` blocking client-supplied `actor_id`, `actor_role`, `branch_id`, `p_*` RPC params, and manager protected fields. |
| Error Handling | `src/errors/gateway-error.ts` | Minor Gap | Maps `42501`, `P0002`, `23514`, `22023`, `22P02`, `23505`, `23503`, `P0001`, `55000`. **Gap:** passes raw PostgreSQL `payload.message` for constraint errors (`23505`/`23503`), which may expose internal constraint names. |
| Log Sanitization | `src/security/log-sanitizer.ts` | Verified | Redacts `Bearer` tokens, JWTs, 64-char hex digests, and keys matching `secret\|key\|token\|authorization\|cookie\|password\|passwd\|sig\|signature\|jwt\|hmac`. |
| Env Config | `src/config/env.ts` | Minor Gap | Fails closed on missing/placeholder secrets, `<32`-byte HMAC secrets, non-HTTPS non-local URLs, TTL > 120s. **Gap:** `loadHmacKeyRing` does not reject future `activatedAt` timestamps. |

---

## 2. Completed vs. Incomplete Summary

- **Completed:** Zero-trust Gateway core for Central JWT verification, identity resolution, v2.7 HMAC envelope signing/rotation, nonce handling, SQL v2.7.1 leave RPC integration, strict input validation, log sanitization, and 32 passing unit/wire/HTTP security tests.
- **Incomplete (Required in Phase 4.2):**
  1. Enforce `activatedAt <= now` in `env.ts` and `hmac-signer.ts`.
  2. Sanitize constraint error messages in `mapPostgrestError` (`gateway-error.ts`).
  3. Add Central & Branch A read/domain endpoints (`employee_directory`, `attendance_daily_summaries`, `shifts`, `employee_schedules`, `attendance`, `leave_requests` GET).
  4. Add HTTP server timeouts, graceful shutdown, and CORS policy.
  5. Provision active 256-bit HMAC key out-of-band into `nexus_internal.gateway_signing_keys` and Gateway runtime env before live RPC execution.
