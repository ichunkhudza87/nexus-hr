# NEXUS HR — PHASE 3.12B.1 SECURITY AUDIT REPORT
**Phase:** 3.12B.1 — Read-Only Gateway Source Code Security Audit  
**Workspace:** `D:\Antigravity_Projects\nexus-hr`  
**Audit Date:** 2026-11-11  
**Mode:** STRICT READ-ONLY (No remote SQL executed; no Gateway code or SQL migration files modified)  
**Baseline Reviewed:**
- Phase 3.12A Security Architecture & SQL Spec v2.6 (`docs/architecture/phase_3_12a/*`)
- Phase 3.12B Backend API Gateway (`gateway/src/**/*`)
- Baseline Schema Migrations (`supabase/migrations/001_central_schema.sql`, `002_branch_a_schema.sql`)
- Repository Hygiene Templates (`.gitignore`, `.env.example`, `gateway/package.json`, `gateway/tsconfig.json`)

---

## Executive Summary

A line-by-line, read-only security audit was conducted on all 13 TypeScript source files and 5 test suites in `gateway/src/`, together with the Phase 3.12A v2.6 SQL specification (`PHASE_3_12A_REMEDIATION_V2_6.sql`) and existing schema migrations.

The Phase 3.12B Gateway establishes a strong **fail-closed zero-trust foundation**:
- Asymmetric JWKS-only Central JWT signature verification (rejecting `alg=none` and rejecting `HS256` in production runtime where `hs256Secret` is unconfigured),
- Authoritative Central `user_profiles` + `branches` verification and Branch A `employees` lookup bypassing untrusted JWT claims,
- Strict HTTP input allow-listing with explicit rejection of client-supplied actor/branch/audit fields (`FORBIDDEN_IDENTITY_FIELD`),
- Cryptographically matching 10-field canonical HMAC-SHA256 signing (`buildCanonicalActorPayload` vs. `verify_gateway_actor()`),
- Strict JSON log sanitization stripping `Bearer`, JWTs, 64-char hex strings, and sensitive keys, plus secret-free error mapping.

However, the audit identified **two High-severity integration/contract defects** between the Gateway implementation and `PHASE_3_12A_REMEDIATION_V2_6.sql` that **block immediate progression to SQL execution (Phase 3.12C)**, plus several Medium/Low hardening gaps:
1. **`F-01` [HIGH] HMAC Key Rotation & Revocation Contract Mismatch:** `ActorHmacSigner` emits `keyId` and supports rotation/revocation, but `HttpBranchAClient` drops `envelope.keyId`, and `PHASE_3_12A_REMEDIATION_V2_6.sql` lacks `p_key_id`, `revoked_at`, and `key_id` canonical binding.
2. **`F-02` [HIGH] Partial `SUPERADMIN` `CORRECTION` Null-Overwrite Bug:** `HttpBranchAClient.superadminUpdateLeaveRequest()` converts omitted optional fields (`undefined`) to `null`, and `rpc_superadmin_update_leave_request` in SQL v2.6 unconditionally overwrites `rejection_reason`, `approved_by`, and `approved_at` with `NULL` — silently corrupting decision metadata and crashing (`23514` `chk_leave_rejection_reason`) on partial corrections to `REJECTED` requests.

---

## Detailed Audit Sections (A–I)

### Audit A — Architecture & Trust Boundary Analysis

- **Topology:** Untrusted Client -> Gateway (`gateway/src/index.ts`, `gateway/src/app.ts`) -> Central Supabase PostgREST (`HttpCentralClient`) + Central JWKS (`CentralJwtVerifier`) -> Branch A Supabase PostgREST RPC (`HttpBranchAClient`) -> PostgreSQL `SECURITY DEFINER` RPCs + `nexus_internal` schema.
- **Boundary Enforcement:**
  - `gateway/src/app.ts` (L68-117) enforces `GET /health` without auth, `POST /api/v1/leave-requests/:id/decide` (`LEAVE_DECIDE`), and `PATCH /api/v1/admin/leave-requests/:id` (`LEAVE_SUPERADMIN_UPDATE`).
  - `gateway/src/services/leave-service.ts` (L39-44, L72-77) verifies role **server-side** from `ResolvedActor.actorRole` (`BRANCH_MANAGER` for `/decide`; `SUPERADMIN` for `/admin`) after authentication and identity resolution.
  - All `UUID` path parameters are validated against RFC-style regex (`leave-schemas.ts` L42-50) before invoking services.
- **Gaps Observed:**
  - `HttpCentralClient` and `HttpBranchAClient` hold `service_role` keys purely inside Gateway server memory; no `service_role` credential is returned to callers or logged.
  - **Gap (`F-05`):** Horizontal scaling / process restart loses inbound `X-Request-Nonce` replay state because `NonceStore` is process-local memory. Outbound RPC actor nonces (`nexus_internal.used_actor_nonces`) are shared and durable at DB level, provided SQL v2.7 is deployed.

---

### Audit B — Central JWT Verification (`gateway/src/auth/central-jwt.ts`)

| Check | Implementation Evidence | Status |
|---|---|---|
| Asymmetric algorithms | `ALLOWED_ASYMMETRIC_ALGS = Set(['ES256', 'ES384', 'RS256', 'EdDSA'])` (`central-jwt.ts` L7) | PASS |
| `alg=none` rejection | Rejected at `central-jwt.ts` L82-84 | PASS |
| `HS256` algorithm confusion | Rejected unless `hs256Secret` configured (`L89-99`); `index.ts` L16-23 omits `hs256Secret` | PASS |
| `iss`, `aud`, `exp`, `nbf`, `sub` | Validated strictly (`L112-156`) with configurable `clockSkewSeconds` (default `5s`, `env.ts` L138-145) | PASS |
| JWKS reachability failure | Fails closed with `503 JWKS_UNAVAILABLE` on network/HTTP/parse errors (`L206-222`) | PASS |
| Unknown `kid` handling | Rate-limited refresh (`10_000ms`, `L160`, `L197`); fails closed if key still missing | WARN (`F-04`) |

**Findings in Audit B (`F-04`):**
1. **No single-flight lock on JWKS refresh (`central-jwt.ts` L159-163, L196-216):** When the 300s cache expires under concurrent traffic, multiple requests issue redundant upstream fetches simultaneously.
2. **Global 10s unknown-`kid` refresh throttle:** If two signing keys roll rapidly within 10s, the second unknown `kid` triggers rate-limit skip on `refreshJwks()` until 10s elapses.
3. **Omitted JWT `kid` header (`L180-185`):** If a JWT omits `kid`, `findMatchingKey()` returns only the **first** key matching `alg/use/kty` rather than rejecting missing `kid` when JWKS contains multiple active keys of the same algorithm or verifying against all candidate keys.

---

### Audit C — Identity Resolution & Central Directory Validation (`gateway/src/auth/identity-resolver.ts`, `clients/central-client.ts`)

- **Central Profile Verification (`identity-resolver.ts` L33-45):**
  - Looks up `user_profiles` via `claims.sub` (not JWT `email` or JWT `app_metadata`).
  - Fails closed (`403`) if profile is missing, `is_active !== true`, `email` is blank/non-string, or `role` is not in `USER_ROLES`.
- **Branch Verification (`L47-60`):**
  - Non-enterprise roles (`BRANCH_MANAGER`, `BRANCH_HR`, `EMPLOYEE`) must match `expectedBranchAId` (`00000000-0000-0000-0000-000000000001`), `profile.branch.code === 'BRANCH-A'`, and `profile.branch.is_active === true`.
- **Branch A Employee Lookup (`L62-77`):**
  - Queries Branch A `employees` filtered by `user_auth_id = profile.id` and `is_deleted = false`, then filters `is_active === true`.
  - Rejects duplicate active rows (`> 1` -> `409 DUPLICATE_EMPLOYEE_IDENTITY`).
  - Requires `employeeId` (`403`) for `BRANCH_MANAGER`, `BRANCH_HR`, `EMPLOYEE`; passes `null` when absent for `SUPERADMIN` / `CENTRAL_HR`.
- **Central Schema Parity:** Verified against `supabase/migrations/001_central_schema.sql` (`branches` L78-90, `user_profiles` L103-120); foreign-key join `branch:branches(id,code,is_active)` aligns with `user_profiles.branch_id -> branches(id)`.
- **Minor Observation:** `CENTRAL_HR` is accepted by `IdentityResolver` (`L47`) and `USER_ROLES`, then blocked at `LeaveService` role checks (`L40`, `L73`) and SQL `verify_gateway_actor()` (v2.6 L161). Safe and fail-closed.

---

### Audit D — Request Input Validation & Anti-Tampering (`gateway/src/validation/leave-schemas.ts`)

- **Strict Body Parsing (`app.ts`, `leave-schemas.ts`):** Expects JSON object (`400 INVALID_PAYLOAD` / `INVALID_JSON`). Note `MAX_BODY_BYTES = 32_768` (`32 KiB`) bounds memory exhaustion cleanly (`app.ts`).
- **Forbidden Actor / Impersonation Fields (`leave-schemas.ts` L15-31):**
  - Explicit `FORBIDDEN_IDENTITY_FIELD` (`400`) rejection for: `actor_id`, `actor_user_id`, `actor_email`, `actor_role`, `actor_sig`, `actor_employee_id`, `employee_id_actor`, `branch_id`, `branch_code`, `user_role`, `p_actor_user_id`, `p_actor_role`, `p_actor_sig`, `p_nonce`, `p_exp`.
  - Plus strict allow-listing (`allowedKeys` checks at `L79-83` for manager decision; `L128-132` for superadmin update) returns `400 FORBIDDEN_IDENTITY_FIELD` / `UNKNOWN_FIELD` for any disallowed field (e.g., `approved_by`, `total_days`, `employee_id` on `/decide`).
- **Business Input Validation:**
  - `BRANCH_MANAGER` `/decide` (`L71-118`): requires `decision IN ('APPROVED', 'REJECTED')`, enforces non-empty `rejection_reason` (`<= 2000` chars) when `'REJECTED'`, forbids `rejection_reason` when `'APPROVED'`.
  - `SUPERADMIN` `/admin` (`L120-209`): validates `operation_mode IN ('DECISION', 'CORRECTION')`, UUID format on `employee_id`/`approved_by`, ISO date (`YYYY-MM-DD`) and `end_date >= start_date`, positive finite `total_days <= 366`, valid `leave_type` & `status`, `rejection_reason` requirement on `status === 'REJECTED'`, ISO timestamp on `approved_at`.
- **Gap (`F-02`, `F-08`):**
  - `F-02` [HIGH]: `validateSuperadminUpdateInput` leaves omitted optional keys as `undefined`, but `HttpBranchAClient.superadminUpdateLeaveRequest` (`branch-rpc-client.ts` L124-126) turns `undefined` into `null`, and SQL v2.6 overwrites existing values with `NULL` in `CORRECTION` mode.
  - `F-08` [LOW]: In `CORRECTION` mode, if `status` is omitted while `rejection_reason` is supplied (or vice versa), validation only sees `body.status === 'REJECTED'` (`leave-schemas.ts` L180), deferring cross-field state consistency to DB constraints. This is acceptable **only once `F-02` partial-update preservation is fixed in SQL v2.7**.

---

### Audit E — Out-of-Band HMAC Signing, Key Management & Canonical Contract (`gateway/src/security/hmac-signer.ts`, `clients/branch-rpc-client.ts`)

- **Canonical Payload Parity (`hmac-signer.ts` L28-41 vs `PHASE_3_12A_REMEDIATION_V2_6.sql` L189-200):**
  ```
  <action_scope>|<lowercase_target_id>|<operation_mode>|<lowercase_actor_user_id>|<lowercase_trim_actor_email>|<actor_role>|<lowercase_branch_id_or_empty>|<lowercase_employee_id_or_empty>|<exp_epoch_seconds>|<lowercase_nonce>
  ```
  Verified **byte-for-byte identical** across Node.js `ActorHmacSigner` (`hmac('sha256', Buffer.from(secret, 'utf8'))`) and PostgreSQL `extensions.hmac(convert_to(v_payload, 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256')`.
- **CRITICAL DEFECT (`F-01` [HIGH]): Key Rotation & Revocation Broken Across Gateway <-> DB Boundary:**
  - `ActorHmacSigner` stores `HmacSigningKeyRecord[]` with `keyId`, `isActive`, `rotatedAt`, `revokedAt`, returns `envelope.keyId` (`L151`), and supports overlap grace periods and immediate revocation (`rotateKey`, `revokeKey`).
  - **Mismatch 1:** `HttpBranchAClient.decideLeaveRequest()` (`branch-rpc-client.ts` L88-100) and `superadminUpdateLeaveRequest()` (`L114-135`) **do not transmit `envelope.keyId`** (`p_key_id` omitted).
  - **Mismatch 2:** `PHASE_3_12A_REMEDIATION_V2_6.sql` `nexus_internal.gateway_signing_keys` (`L68-74`) lacks `revoked_at`, and `verify_gateway_actor()` (`L178-186`) ignores `key_id` completely, selecting `WHERE is_active = TRUE ORDER BY created_at DESC LIMIT 1`.
  - **Mismatch 3:** Canonical payload does not bind `key_id`, so neither DB nor Gateway cryptographically authenticates which key identifier was claimed once multiple active keys exist during a grace window.
  - **Impact:** Zero-downtime key rotation fails during rollover; DB rejects valid in-flight v1 envelopes the moment v2 is inserted with `is_active = TRUE`.
- **Note on Secret Encoding (`F-09` [LOW]):** Gateway (`env.ts` L64-86, `hmac-signer.ts` L44) hashes the raw UTF-8 bytes of `GATEWAY_ACTOR_HMAC_KEY` (64 hex chars = 64 UTF-8 bytes), matching SQL `convert_to(v_secret, 'UTF8')`. Operations runbooks must explicitly mandate storing the exact same 64-char hex string in `nexus_internal.gateway_signing_keys.hmac_secret` (no hex-decoding on one side only).

---

### Audit F — Replay Protection & Nonce Lifecycle (`gateway/src/security/nonce-store.ts`, `app.ts`)

- **Outbound RPC Nonces:** Generated with Node `crypto.randomUUID()` (`nonce-store.ts` L29), bounded TTL (`<= 120s`, configured `60s`), intended for single-use atomic `INSERT ... ON CONFLICT (nonce) DO NOTHING` in `nexus_internal.used_actor_nonces`.
- **DEFECT (`F-06` [LOW]): Collision Check Prefix Bug (`nonce-store.ts` L34-37):**
  - `issueOutboundNonce()` checks `this.seenNonces.has(nonce)` without `'out:'`, while storing `'out:' + nonce`.
- **GAP (`F-05` [MEDIUM]): Inbound HTTP Nonce Store Volatility & DoS Eviction:**
  - `NonceStore` uses process-local `Map<string, number>()` (`L11`). Multiple Gateway instances or restarts drop inbound `X-Request-Nonce` replay history.
  - `X-Request-Nonce` header is optional (`app.ts` L89-92); `claims.jti` tracking (`app.ts` L96-99) is unimplemented (placeholder comment).
  - `pruneExpired()` performs `O(N)` full-Map scan on every call; reaching `maxEntries` (`100_000`) evicts the oldest entry even if unexpired, enabling flood eviction of active inbound nonces.

---

### Audit G — Service Role Isolation, Log Sanitization & Error Handling (`errors/gateway-error.ts`, `security/log-sanitizer.ts`, `app.ts`)

- **Service Role Isolation:** Gateway `service_role` keys (`SUPABASE_CENTRAL_SERVICE_ROLE_KEY`, `SUPABASE_BRANCH_A_SERVICE_ROLE_KEY`) are used strictly in `HttpCentralClient` / `HttpBranchAClient` Authorization & `apikey` headers, never logged or returned.
- **Log Sanitization (`log-sanitizer.ts` L1-75):**
  - Redacts matching object keys (`/secret|key|token|authorization|cookie|password|passwd|sig|signature|jwt|hmac/i` -> `'[REDACTED]'`), strips `Bearer ...`, JWTs (`eyJ...`), and 64-char hex secrets (`[REDACTED_HEX64]`), including inside `Error.message`. Verified tested in `leave-service-http.test.ts` L317-323.
  - Minor edge case: Case-sensitive `SENSITIVE_KEY_PATTERN` + string regex leaves sub-64-char non-hex secrets if placed under a non-sensitive key name, though all key/sig fields use sensitive names. Safe.
- **Error Mapping (`gateway-error.ts` L24-54):**
  - Translates PostgreSQL SQLSTATE codes (`42501` -> `403`, `P0002` -> `404`, `23514`/`22023`/`22P02` -> `422`, `23505`/`23503`/`P0001` -> `409` or `403`/`404`, `55000` -> `503`), and maps unknown upstream failures to generic `502 UPSTREAM_RPC_ERROR` (`'Branch RPC request failed.'`).

---

### Audit H — Database Contract Readiness & SQL v2.6 -> v2.7 Gaps

Inspected `PHASE_3_12A_REMEDIATION_V2_6.sql`, `001_central_schema.sql`, and `002_branch_a_schema.sql`:
1. **Remote DB Still Pre-Remediation:** `002_branch_a_schema.sql` currently deployed on Branch A (`uneycmbqqpkifwhwzbes`) still grants `UPDATE` on `leave_requests` to `authenticated` (L1097), still carries the vulnerable `leave_manager_decide` RLS policy (L1069-1073), and lacks `nexus_internal`, `verify_gateway_actor`, `rpc_branch_decide_leave_request`, and `rpc_superadmin_update_leave_request`. Gateway **cannot operate against remote Branch A until SQL v2.7 is deployed**.
2. **`F-01` SQL v2.6 lacks `key_id` / `revoked_at`:** Needs `p_key_id` support + canonical binding.
3. **`F-02` SQL v2.6 `CORRECTION` overwrites omitted fields with `NULL`:** Needs explicit partial-update preservation (`p_set_*` flags or tri-state semantics).
4. **`F-03` [MEDIUM-HIGH] RLS Policy Alignment with Owner Decision #1:** `PHASE_3_12A_REMEDIATION_V2_6.sql` L763 drops `leave_manager_decide` cleanly alongside `REVOKE UPDATE ... FROM authenticated`. To satisfy Owner Decision #1 defense-in-depth explicitly if `UPDATE` is ever evaluated for employee cancellation or future roles, SQL v2.7 should document/install an explicit hardened RLS policy posture (e.g., employee-only `PENDING -> CANCELLED` if allowed or explicit fail-closed UPDATE policy + verification tests), alongside `REVOKE UPDATE` on `leave_requests` from `authenticated`.
5. **`F-07` [MEDIUM] Per-Call Cleanup Lock Contention & Role Scope:** `verify_gateway_actor()` (SQL v2.6 L214-215, L262-263) executes unbounded `DELETE` statements on `used_actor_nonces` and `tx_actor_context` on every RPC verification, and admits `BRANCH_HR` / `EMPLOYEE` at HMAC layer even though only `BRANCH_MANAGER` and `SUPERADMIN` execute leave mutations.

---

### Audit I — Configuration, Secrets Hygiene & File Safety

- **Environment Validation (`gateway/src/config/env.ts`):**
  - Fails closed if required variables are missing or contain placeholder strings (`replace_with`, `your_`, `changeme`, `placeholder`, `L40-52`).
  - Rejects HMAC secrets `< 32` UTF-8 bytes (`L76-78`).
  - Rejects non-HTTPS Supabase / JWKS URLs except `localhost`/`127.0.0.1` (`L103-114`).
  - Clamps `GATEWAY_ACTOR_TTL_SECONDS` to `1..120` matching SQL v2.6 120s max (`L147-155`).
  - Validates JSON key ring via `GATEWAY_ACTOR_HMAC_KEYS_JSON` guaranteeing an active, unrevoked `activeHmacKeyId` (`L169-185`).
- **Git & Template Hygiene:**
  - `.gitignore` ignores `.env`, `.env.*`, `*.pem`, `*.key`, `node_modules/`, `dist/`, `coverage/`, while exempting `!.env.example`.
  - `.env.example` contains only placeholder strings; zero live credentials exist in `.env.example` or `gateway/src/`.
  - Local `gateway` TypeScript setup uses Node 22+ native type stripping (`"engines": { "node": ">=22.12.0" }`, `tsconfig.json` `erasableSyntaxOnly: true`); verified under Node `v25.9.0`.
