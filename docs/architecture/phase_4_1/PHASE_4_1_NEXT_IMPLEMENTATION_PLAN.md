# NEXUS HR — PHASE 4.1 NEXT IMPLEMENTATION PLAN (PHASE 4.2 ROADMAP)

**Current Classification:** **`READY WITH REMEDIATION — LOCAL FIXES REQUIRED`**

---

## 1. Implementation Sequence for Phase 4.2

### Step 1 — Local Security & Validation Fixes (Before Any Live Integration)
1. **`activatedAt` Lifecycle Enforcement (`SEC-41-01`):**
   - Update `gateway/src/config/env.ts` (`loadHmacKeyRing`) and `gateway/src/security/hmac-signer.ts` (`getActiveKey`, `verifyEnvelope`) to validate `activatedAt` timestamps and reject keys where `activatedAt > now`.
   - Add unit tests in `env-config.test.ts` and `hmac-and-nonce.test.ts`.
2. **Constraint Error Sanitization (`SEC-41-02`):**
   - Update `gateway/src/errors/gateway-error.ts` (`mapPostgrestError`) so unexpected `23505`/`23503` database constraint messages are replaced with safe client-facing messages while full sanitized details are logged internally.
   - Add test coverage in `http-clients-wire.test.ts`.
3. **HTTP Server Hardening & CORS (`SEC-41-03`):**
   - Add `CORS_ALLOWED_ORIGINS` handling (`OPTIONS` preflight + origin allowlist) in `src/app.ts` / `src/config/env.ts`.
   - Add `requestTimeout`, `headersTimeout`, `keepAliveTimeout`, and `SIGINT`/`SIGTERM` graceful shutdown in `src/index.ts`.

### Step 2 — Complete Database Connection Contract Endpoints
4. **Central Read Endpoints (`HttpCentralClient` + Routes):**
   - `GET /api/v1/central/employee-directory` (reading `public.employee_directory`, restricted to `SUPERADMIN` / `CENTRAL_HR`).
   - `GET /api/v1/central/attendance-summaries` (reading `public.attendance_daily_summaries`, restricted to `SUPERADMIN` / `CENTRAL_HR`).
5. **Branch A Read/Domain Endpoints (`HttpBranchAClient` + Routes):**
   - `GET /api/v1/leave-requests` (scoped by role/employee).
   - `GET /api/v1/employees` (scoped by role).
   - `GET /api/v1/shifts` and `GET /api/v1/employee-schedules`.
   - `GET /api/v1/attendance` (and any authorized check-in/attendance endpoints).
   - Add full unit + mocked HTTP wire tests for all new endpoints.

### Step 3 — Out-of-Band Key Provisioning & Controlled Integration Verification (Separate Authorized Phase)
6. **HMAC Key Provisioning:**
   - Generate a 256-bit CSPRNG secret out-of-band (never in VCS).
   - Insert into `nexus_internal.gateway_signing_keys` on `nexus-branch-a` (`uneycmbqqpkifwhwzbes`) and configure matching `GATEWAY_ACTOR_HMAC_KEY_ID` / `GATEWAY_ACTOR_HMAC_KEY` in Gateway runtime environment.
7. **Live Integration Smoke Tests (Authorized Staging/Test Only):**
   - Verify Central JWKS + `user_profiles` resolution + Branch A `rpc_branch_decide_leave_request` / `rpc_superadmin_update_leave_request` end-to-end.
