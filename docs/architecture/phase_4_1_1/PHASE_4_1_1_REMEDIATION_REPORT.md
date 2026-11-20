# NEXUS HR — PHASE 4.1.1 REMEDIATION REPORT

**Workspace:** `D:\Antigravity_Projects\nexus-hr\gateway\`  
**Date:** 2026-11-12 (UTC+7)  
**Classification:** **`READY FOR PHASE 4.2 — GATEWAY DATABASE INTEGRATION`**

---

## 1. Executive Summary

Phase 4.1.1 successfully remediated all security and operational findings identified in Phase 4.1 without regressing or modifying any SQL baseline migrations, SQL remediation files, or remote database configurations.

All 32 baseline tests continue to pass without modification or weakening, and 8 new security and API integration tests were added, bringing the verified test suite to **40/40 PASS** (`node --test src/__tests__/*.test.ts`).

---

## 2. Remediated Security Items

### SEC-41-01: `activatedAt` Lifecycle Enforcement
- **Files Modified:** `src/config/env.ts`, `src/security/hmac-signer.ts`
- **Remediation Details:**
  1. `env.ts` (`loadHmacKeyRing`): Validates that `activatedAt` is a valid ISO timestamp and computes `isActivated = Date.parse(activatedAt) <= Date.now()`. Keys with future `activatedAt` are marked `isActive = false` and excluded from `isUsable()`.
  2. `hmac-signer.ts`: Added helper functions `isKeyActivated(key, nowEpoch)` and `isKeyUsable(key, nowEpoch)`. `getActiveKey()` raises HTTP `503 SIGNING_KEY_UNAVAILABLE` if the designated active key is not yet activated. `verifyEnvelope()` rejects envelopes signed by keys whose `activatedAt > nowEpoch`.
- **Test Evidence:** Added tests in `sec-41-remediation.test.ts` verifying rejection of future activation, successful activation at current or past timestamps, and rejection during `verifyEnvelope`.

### SEC-41-02: Database Error Message Sanitization
- **Files Modified:** `src/errors/gateway-error.ts`, `src/app.ts`
- **Remediation Details:**
  1. `gateway-error.ts` (`mapPostgrestError`): For SQLSTATE `23505` (unique constraint violation), replaced raw PostgREST error messages with the generic client-safe message `"A conflicting record already exists."`. For `23503` (foreign key violation), replaced with `"Referenced record does not exist or cannot be linked."`.
  2. Preserved complete database diagnostic details (`pgCode`, `httpStatus`, `pgMessage`, `pgDetails`, `pgHint`) inside `GatewayError.internalDetail`, which is logged by `createGatewayHandler` (`src/app.ts`) through `log-sanitizer.ts` without leaking to the HTTP client response.
- **Test Evidence:** Added tests in `sec-41-remediation.test.ts` verifying that raw PostgreSQL table names and constraint identifiers do not appear in HTTP responses.

### SEC-41-03: HTTP Server Hardening & CORS
- **Files Modified:** `src/app.ts`, `src/index.ts`, `src/config/env.ts`, `.env.example`
- **Remediation Details:**
  1. **CORS Allowlist:** Configured `CORS_ALLOWED_ORIGINS` in `env.ts` (comma-separated allowlist; wildcards `*` with credentials strictly prohibited). Implemented preflight `OPTIONS` handling (HTTP 204) and origin validation in `app.ts`. Disallowed origins receive HTTP `403 CORS_FORBIDDEN`.
  2. **Server Timeouts:** Set `server.requestTimeout = config.requestTimeoutMs`, `server.headersTimeout = config.requestTimeoutMs + 1000`, and `server.keepAliveTimeout = 5000` in `index.ts`.
  3. **Graceful Shutdown:** Implemented orderly shutdown on `SIGINT` and `SIGTERM` in `index.ts`, guarded with `isShuttingDown` to prevent double-closure, along with a 10s unref'd force-exit watchdog timer.
- **Test Evidence:** Added tests in `read-endpoints-http.test.ts` verifying CORS `OPTIONS` preflight, allowed origin headers, and `403 CORS_FORBIDDEN` on unauthorized origins.

---

## 3. API Read Endpoints Implementation

Seven authorized read endpoints were implemented in `src/app.ts`, backed by type-safe query validators in `src/validation/read-schemas.ts` and REST client methods in `src/clients/central-client.ts` and `src/clients/branch-rpc-client.ts`.

### Central Endpoints
1. `GET /api/dashboard/summary`: Reads corporate attendance rollups from `public.attendance_daily_summaries`. Non-enterprise roles are automatically scoped to `branch_id = BRANCH_A_ID`.
2. `GET /api/employees/directory`: Reads employee directory projections from `public.employee_directory`. Non-enterprise roles are automatically scoped to `branch_id = BRANCH_A_ID`.

### Branch A Endpoints
3. `GET /api/employees`: Reads branch employees from `public.employees`. `EMPLOYEE` role is automatically restricted to `employee_id = actor.employeeId`.
4. `GET /api/shifts`: Reads shift definitions from `public.shifts`.
5. `GET /api/schedules`: Reads shift roster assignments from `public.employee_schedules`. `EMPLOYEE` role is automatically restricted to `employee_id = actor.employeeId`.
6. `GET /api/attendance`: Reads attendance check-ins from `public.attendance`. `EMPLOYEE` role is automatically restricted to `employee_id = actor.employeeId`.
7. `GET /api/leave-requests`: Reads leave applications from `public.leave_requests`. `EMPLOYEE` role is automatically restricted to `employee_id = actor.employeeId`.

All endpoints require Central JWT Bearer authentication, reject forbidden client-supplied identity/authority parameters (`actor_id`, `role`, etc.) with HTTP `400 FORBIDDEN_IDENTITY_FIELD`, enforce pagination (`page`, `page_size <= 100`), and validate ISO dates and enum fields.

---

## 4. Key Provisioning Readiness Status
- The Gateway fails closed if no usable active HMAC signing key is present (HTTP `503 SIGNING_KEY_UNAVAILABLE`).
- No production HMAC secrets have been hardcoded or provisioned. Key provisioning remains an out-of-band operational step to be performed in Phase 4.2 prior to live remote RPC execution.
