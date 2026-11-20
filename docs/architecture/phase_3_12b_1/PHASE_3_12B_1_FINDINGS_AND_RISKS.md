# NEXUS HR — PHASE 3.12B.1 FINDINGS AND RISK REGISTER
**Phase:** 3.12B.1 — Read-Only Gateway Source Code Security Audit  
**Workspace:** `D:\Antigravity_Projects\nexus-hr`

---

## Risk Matrix Summary

| Finding ID | Severity | Component | Summary | Blocks Phase 3.12C? |
|---|---|---|---|---|
| `F-01` | **HIGH** | `hmac-signer.ts`, `branch-rpc-client.ts`, `PHASE_3_12A_REMEDIATION_V2_6.sql` | HMAC `keyId` rotation/revocation unsupported across Gateway -> DB RPC boundary | **YES** |
| `F-02` | **HIGH** | `branch-rpc-client.ts`, `leave-schemas.ts`, `PHASE_3_12A_REMEDIATION_V2_6.sql` | Partial `SUPERADMIN` `CORRECTION` overwrites omitted `approved_by`/`approved_at`/`rejection_reason` with `NULL` | **YES** |
| `F-03` | **MEDIUM-HIGH** | `PHASE_3_12A_REMEDIATION_V2_6.sql`, `002_branch_a_schema.sql` | Defense-in-depth `FOR UPDATE` RLS policy missing on `leave_requests` after dropping `leave_manager_decide`; remote Branch A still pre-remediation | **YES** (in SQL v2.7) |
| `F-04` | **MEDIUM** | `central-jwt.ts` | No single-flight lock on JWKS refresh; global 10s unknown-`kid` throttle; omitted-`kid` selects first key only | Conditional / Hardening |
| `F-05` | **MEDIUM** | `nonce-store.ts`, `app.ts` | Inbound `X-Request-Nonce` is optional & process-local in-memory only; flood eviction possible at `maxEntries` | Conditional / Hardening |
| `F-06` | **LOW** | `nonce-store.ts` | `issueOutboundNonce` collision check lacks `'out:'` prefix (`seenNonces.has(nonce)` vs `recordNonce('out:' + nonce)`) | Fix before 3.12C |
| `F-07` | **MEDIUM** | `PHASE_3_12A_REMEDIATION_V2_6.sql` | Unbounded per-call `DELETE` inside `verify_gateway_actor()` causes write/index lock contention; `BRANCH_HR`/`EMPLOYEE` allowed at HMAC verifier | **YES** (in SQL v2.7) |
| `F-08` | **LOW** | `leave-schemas.ts` | Partial `CORRECTION` with omitted `status` defers `rejection_reason` cross-field check entirely to DB | Mitigated once `F-02` fixed |
| `F-09` | **LOW** | `hmac-signer.ts`, `.env.example` | Dual-side UTF-8 byte interpretation of 64-char hex secret requires strict ops parity | Documentation / Runbook |

---

## Detailed Findings

### `F-01` [HIGH] — HMAC Key Rotation & Revocation Contract Mismatch (`keyId` Dropped & Unbound)

- **Locations:**
  - `gateway/src/security/hmac-signer.ts` (`ActorHmacSigner`, `SignedActorEnvelope.keyId`, `buildCanonicalActorPayload` L28-41, `rotateKey`, `revokeKey`)
  - `gateway/src/clients/branch-rpc-client.ts` (`HttpBranchAClient.decideLeaveRequest` L88-100, `superadminUpdateLeaveRequest` L114-135)
  - `docs/architecture/phase_3_12a/PHASE_3_12A_REMEDIATION_V2_6.sql` (`gateway_signing_keys` L68-74, `verify_gateway_actor` L109-200)
- **Evidence:**
  - Gateway emits `envelope.keyId`, supports multiple keys (`GATEWAY_ACTOR_HMAC_KEYS_JSON`), and passes unit test *"supports zero-downtime key rotation and immediate key revocation"* using in-memory `signer.verifyEnvelope()`.
  - However, `HttpBranchAClient` omits `envelope.keyId` from both PostgREST RPC JSON bodies, `verify_gateway_actor()` does not accept `p_key_id`, `gateway_signing_keys` has no `revoked_at` column, and SQL v2.6 only fetches `SELECT hmac_secret ... WHERE is_active = TRUE ORDER BY created_at DESC LIMIT 1`.
- **Impact:** Zero-downtime rotation is non-functional in production: activating key `v2` in PostgreSQL immediately causes all in-flight envelopes signed with `v1` (or requests from instances still rotating to `v2`) to fail `403 FORBIDDEN`. Furthermore, `keyId` is excluded from the signed canonical string.
- **Remediation:** Update SQL v2.7 + `hmac-signer.ts` + `branch-rpc-client.ts` per Contract `C-01` & `C-04` (`PHASE_3_12B_1_SQL_V2_7_CONTRACT.md`).

---

### `F-02` [HIGH] — Partial `SUPERADMIN` `CORRECTION` Null-Overwrite & `23514` Constraint Crash

- **Locations:**
  - `gateway/src/clients/branch-rpc-client.ts` (`superadminUpdateLeaveRequest` L124-126)
  - `gateway/src/validation/leave-schemas.ts` (`validateSuperadminUpdateInput` L120-209)
  - `docs/architecture/phase_3_12a/PHASE_3_12A_REMEDIATION_V2_6.sql` (`rpc_superadmin_update_leave_request` L719-731)
- **Evidence:**
  - `HttpBranchAClient` passes `p_rejection_reason: input.rejectionReason ?? null`, `p_approved_by: input.approvedBy ?? null`, `p_approved_at: input.approvedAt ?? null`.
  - In `CORRECTION` mode, SQL v2.6 executes:
    `rejection_reason = CASE WHEN p_operation_mode = 'CORRECTION' THEN p_rejection_reason ...`
    `approved_by = CASE WHEN p_operation_mode = 'CORRECTION' THEN p_approved_by ...`
    `approved_at = CASE WHEN p_operation_mode = 'CORRECTION' THEN p_approved_at ...`
  - Notice `leave-service-http.test.ts` lines 302-308 sends `{ operation_mode: 'CORRECTION', leave_type: 'SICK', total_days: 3, reason: 'Corrected medical cert' }` without `approved_by`, `approved_at`, or `rejection_reason` — which only "passed" in tests because the mocked `branchClient` substituted `input.approvedBy ?? envelope.actorUserId` instead of PostgreSQL's `NULL` behavior!
- **Impact:** Partial corrections by `SUPERADMIN` silently erase `approved_by`, `approved_at`, and `rejection_reason` in PostgreSQL `leave_requests` and `audit_logs`, and fail with HTTP `422` (`23514` `chk_leave_rejection_reason`) whenever correcting a `REJECTED` leave request without resending `rejection_reason`.
- **Remediation:** Implement explicit tri-state field presence flags (`p_set_rejection_reason`, `p_set_approved_by`, `p_set_approved_at`) in SQL v2.7 and distinguish omitted (`undefined`) vs explicit `null` in `leave-schemas.ts` / `branch-rpc-client.ts`.

---

### `F-03` [MEDIUM-HIGH] — Defense-in-Depth `UPDATE` RLS Policy & Pre-Remediation Remote State

- **Locations:**
  - `supabase/migrations/002_branch_a_schema.sql` (L1069-1073 `leave_manager_decide`, L1097 `GRANT SELECT, INSERT, UPDATE ON public.leave_requests TO authenticated`)
  - `docs/architecture/phase_3_12a/PHASE_3_12A_REMEDIATION_V2_6.sql` (L763-771)
- **Evidence:**
  - Remote Branch A (`uneycmbqqpkifwhwzbes`) still runs `002_branch_a_schema.sql` directly allowing `authenticated` users to `UPDATE public.leave_requests` and forge `approved_by` / self-approve if granted role claims.
  - Meanwhile, SQL v2.6 drops `leave_manager_decide` (`L763`) without replacing it with an explicit fail-closed `FOR UPDATE` policy.
- **Impact:** Until SQL v2.7 is deployed, Branch A remains exposed to direct-JWT `UPDATE` bypasses; post-v2.7 without a deny-all `FOR UPDATE` policy, accidental future re-grant of `UPDATE` lacks RLS backstop.
- **Remediation:** Retain `REVOKE UPDATE ON public.leave_requests FROM authenticated, anon, PUBLIC` and add `CREATE POLICY "leave_deny_direct_update" ON public.leave_requests FOR UPDATE TO authenticated USING (FALSE) WITH CHECK (FALSE);` in SQL v2.7 (`C-05`).

---

### `F-04` [MEDIUM] — `CentralJwtVerifier` JWKS Refresh Stampede, Global Throttle & Missing-`kid` Handling

- **Location:** `gateway/src/auth/central-jwt.ts` (L159-216)
- **Evidence:**
  - Cache miss/expiry calls `this.refreshJwks()` without coalescing concurrent in-flight promises.
  - Unknown-`kid` refresh is throttled via a single shared `this.lastRefreshAttemptMs` (`10_000ms`), blocking a second legitimate rotated `kid` within 10s.
  - When JWT header omits `kid`, `findMatchingKey()` returns only the first matching key rather than rejecting missing `kid` or checking all candidate keys of matching `alg`.
- **Impact:** Redundant upstream JWKS requests under traffic spikes on TTL expiry; spurious `401` rejections if keys rotate twice within 10s or if a provider publishes multiple keys of one `alg` and omits `kid`.
- **Remediation:** Add single-flight `inFlightRefresh: Promise<void> | null`, track unknown-`kid` refresh per `kid` (or short backoff), and either reject missing `kid` when JWKS holds multiple matching keys or iterate candidate keys safely.

---

### `F-05` [MEDIUM] — Process-Local & Optional Inbound Replay Protection (`NonceStore`)

- **Locations:** `gateway/src/security/nonce-store.ts` (L11-83), `gateway/src/app.ts` (L89-99)
- **Evidence:**
  - `NonceStore` holds nonces in an in-memory `Map` (`maxEntries = 100_000`).
  - `X-Request-Nonce` is optional in `app.ts` L89-92; `claims.jti` check at L96-99 is a comment-only no-op.
  - `recordNonce` evicts oldest entries when `seenNonces.size >= maxEntries`, and `pruneExpired()` scans the whole Map (`O(N)`) on each request.
- **Impact:** Inbound HTTP replay protection does not persist across Gateway restarts or scale across multiple Gateway instances, and `100_000` distinct invalid/valid requests can evict unexpired inbound nonces prematurely. (Note: DB-level outbound RPC actor nonces in `nexus_internal.used_actor_nonces` remain protected atomically once SQL v2.7 is deployed.)
- **Remediation:** Document single-instance limitation or externalize inbound nonce store (e.g., Redis / DB) before multi-replica scaling; decide whether `X-Request-Nonce` is mandatory for state-changing client routes; cap/index cleanup to avoid full-Map scans.

---

### `F-06` [LOW] — Outbound Nonce Collision Check Prefix Bug

- **Location:** `gateway/src/security/nonce-store.ts` (L34-37)
- **Evidence:**
  ```ts
  // L34: checks bare `nonce`
  if (this.seenNonces.has(nonce)) { ... }
  // L37: inserts `'out:' + nonce`
  this.recordNonce(`out:${nonce}`, exp);
  ```
- **Impact:** Collision guard at L34 always evaluates `false` (mitigated practically only by 122-bit `randomUUID()` collision rarity).
- **Remediation:** Check `this.seenNonces.has(\`out:\${nonce}\`)`.

---

### `F-07` [MEDIUM] — Hot-Path `DELETE` Lock Contention & Over-Broad Role Allow-List in `verify_gateway_actor()`

- **Location:** `docs/architecture/phase_3_12a/PHASE_3_12A_REMEDIATION_V2_6.sql` (L161, L214-215, L262-263)
- **Evidence:** `verify_gateway_actor()` runs full-range `DELETE` on `used_actor_nonces` and `tx_actor_context` on every call, and checks `p_actor_role IN ('SUPERADMIN', 'BRANCH_MANAGER', 'BRANCH_HR', 'EMPLOYEE')`.
- **Impact:** Concurrent RPC throughput degrades due to table/index cleanup locking; non-mutating roles are only blocked later in RPC bodies rather than also at HMAC verification boundary.
- **Remediation:** Apply throttled `LIMIT`-bounded cleanup (`C-03`) and scope-bound role validation inside `verify_gateway_actor()` (`C-06`).

---

### `F-08` [LOW] — `CORRECTION` Mode Cross-Field Pre-Validation Gap

- **Location:** `gateway/src/validation/leave-schemas.ts` (L180-182)
- **Evidence:** Rejection reason requirement only runs when `body.status === 'REJECTED'`. If `status` is omitted while updating a `REJECTED` row and clearing `rejection_reason: null`, DB `chk_leave_rejection_reason` rejects it with `422`.
- **Remediation:** Reject explicit `rejection_reason: null` alongside `status: 'REJECTED'`; let DB enforce against existing row status when `status` is omitted (safe once `F-02` preserves existing `rejection_reason` on `undefined`).

---

### `F-09` [LOW] — Hex-String vs Raw-Byte Key Representation Parity

- **Locations:** `gateway/src/security/hmac-signer.ts` (L44), `gateway/src/config/env.ts` (L64-86), `.env.example` (L56), `PHASE_3_12A_REMEDIATION_V2_6.sql` (L203)
- **Evidence:** Both Gateway (`Buffer.from(secret, 'utf8')`) and SQL (`convert_to(v_secret, 'UTF8')`) consume the UTF-8 bytes of the string rather than hex-decoding it. If provisioned as a 64-char hex string from `randomBytes(32).toString('hex')`, both sides treat it identically as 64 UTF-8 bytes (256 bits entropy).
- **Impact:** Risk only if an operator runs `decode(..., 'hex')` in SQL or `Buffer.from(..., 'hex')` in Gateway.
- **Remediation:** Keep out-of-band provisioning runbook explicit that `hmac_secret` in `nexus_internal.gateway_signing_keys` MUST be inserted as the exact same UTF-8 text string set in `GATEWAY_ACTOR_HMAC_KEY`.
