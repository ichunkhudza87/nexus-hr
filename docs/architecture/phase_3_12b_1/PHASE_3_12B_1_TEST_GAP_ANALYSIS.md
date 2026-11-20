# NEXUS HR — PHASE 3.12B.1 TEST COVERAGE & GAP ANALYSIS
**Phase:** 3.12B.1 — Read-Only Gateway Source Code Security Audit  
**Workspace:** `D:\Antigravity_Projects\nexus-hr`

---

## 1. Observed Local Test Execution Results

Executed read-only against existing codebase (`Set-Location "D:\Antigravity_Projects\nexus-hr\gateway"; node --version; npm test`):

- **Runtime:** Node `v25.9.0`
- **Command:** `npm test` -> `node --test src/__tests__/*.test.ts`
- **Results:**
  - `suites`: **5**
  - `tests`: **24**
  - `pass`: **24**
  - `fail`: **0**
  - `cancelled`: **0**
  - `skipped`: **0**
  - `todo`: **0**
  - `duration_ms`: `1044.6919`

### Breakdown by Existing Suite (Mocked DB Boundary)
1. `CentralJwtVerifier` (`5` tests): Valid `ES256`/`RS256` JWTs, expired tokens, `alg=none`, `HS256` algorithm confusion rejection, wrong `iss`/`aud`/non-UUID `sub`.
2. `loadGatewayConfig` (`6` tests): Valid config, placeholder/missing secrets fail-closed, `< 32`-byte HMAC rejection, non-HTTPS Supabase URL rejection, `GATEWAY_ACTOR_TTL_SECONDS > 120` rejection, JSON key ring rotation/revocation parsing.
3. `ActorHmacSigner & NonceStore` (`4` tests): Canonical 10-field string & Node/PostgreSQL SHA-256 HMAC structure, tampered payload/expired/overlong-TTL detection, in-memory key rotation & revocation (`verifyEnvelope`), inbound nonce replay & TTL expiry.
4. `IdentityResolver` (`5` tests): Active `BRANCH_MANAGER` + matching branch/employee, `SUPERADMIN` without local employee row, missing/inactive Central profile fail-closed, branch mismatch/deactivated branch fail-closed, missing/inactive/deleted employee fail-closed.
5. `Gateway HTTP & LeaveService End-to-End Security Tests (Mocked DB Boundary)` (`4` tests): Rejects client-supplied `actor_id`/`actor_role`/`branch_id`/`approved_by`/`total_days` (`400 FORBIDDEN_IDENTITY_FIELD`), blocks `EMPLOYEE` (`403`), issues verifiable HMAC envelopes for `BRANCH_MANAGER` (including `X-Request-Nonce` replay `409`) and `SUPERADMIN` without leaking JWTs/HMACs/signatures to logs, exposes secret-free `/health`.

---

## 2. Critical Notice on Mocked Test Blind Spots

All 24 existing tests mock `CentralDirectoryClient` and `BranchAClient`. Because the mocks did NOT run against PostgreSQL or inspect the real wire payload produced by `HttpBranchAClient`:
- **High bug `F-01`** (`HttpBranchAClient` dropping `envelope.keyId`) went completely undetected because tests only verified `signer.verifyEnvelope(env)` in memory (`leave-service-http.test.ts` L280, L315).
- **High bug `F-02`** (partial `SUPERADMIN` `CORRECTION` wiping `approved_by`/`approved_at`/`rejection_reason` to `NULL`) went undetected even though `leave-service-http.test.ts` L302-308 literally sent a partial payload — because the mock (`L155-157`) ran `input.approvedBy ?? envelope.actorUserId` instead of PostgreSQL's `CASE WHEN 'CORRECTION' THEN p_approved_by`!

---

## 3. Prioritized Test Gap Register

| Gap ID | Severity | Missing Test Scenario | Required Execution Layer |
|---|---|---|---|
| `GAP-01` | **HIGH** | **Live Wire & PostgreSQL Canonical Parity:** Call real `HttpBranchAClient` against test PostgREST / local PostgreSQL running SQL v2.7 `verify_gateway_actor()` (including `p_key_id`) to prove serialized JSON parameter names & `extensions.hmac` match byte-for-byte | DB Integration (PostgREST + PG17) |
| `GAP-02` | **HIGH** | **Zero-Downtime Key Rotation E2E:** Rotate `gw-v1 -> gw-v2` while `gw-v1` remains active/unrevoked in DB, verify in-flight `v1` envelope & new `v2` envelope both succeed; then revoke `v1` and verify `v1` fails `42501` while `v2` succeeds | Gateway + PG17 Integration |
| `GAP-03` | **HIGH** | **Partial `SUPERADMIN` `CORRECTION` on `REJECTED` & `APPROVED` Rows:** Send `{ operation_mode: 'CORRECTION', total_days: 3 }` without `approved_by`, `approved_at`, or `rejection_reason` and assert PostgreSQL preserves existing `approved_by`, `approved_at`, and `rejection_reason` cleanly without `23514` crash | `HttpBranchAClient` Unit + PG17 Integration |
| `GAP-04` | **HIGH** | **`HttpCentralClient` & `HttpBranchAClient` Wire Tests:** Current suite mocks `CentralDirectoryClient` and `BranchAClient`; `HttpCentralClient` (`central-client.ts`), `HttpBranchAClient` (`branch-rpc-client.ts`), and `mapPostgrestError()` (`gateway-error.ts`) have **zero direct tests** (HTTP timeouts, 4xx/5xx mapping, payload field serialization) | Unit (`fetch` mock) |
| `GAP-05` | **HIGH** | **DB Anti-Self-Approval & Non-`PENDING` Enforcement (`42501` / `P0001`):** Prove real PostgreSQL `rpc_branch_decide_leave_request` rejects `BRANCH_MANAGER` approving own leave, rejecting without reason, and mutating already-`APPROVED` requests, leaving `leave_requests` and `audit_logs` unchanged | PG17 Integration |
| `GAP-06` | **MEDIUM** | **Atomic Outbound Nonce Replay (`used_actor_nonces`):** Replay identical `(p_nonce, p_actor_sig)` concurrently (`Promise.all`) against PG17 to verify `ON CONFLICT DO NOTHING` permits at most 1 commit and rolls back the duplicate cleanly | PG17 Concurrency Integration |
| `GAP-07` | **MEDIUM** | **Trigger & Rollback Atomicity (`tx_actor_context` + `audit_logs` + `leave_summary_rollup`):** Force downstream trigger/constraint failure (e.g., overlapping approved leave) and verify `leave_requests`, `audit_logs`, `used_actor_nonces`, and `tx_actor_context` all roll back cleanly with zero leaked session context | PG17 Integration |
| `GAP-08` | **MEDIUM** | **Direct `authenticated` PostgREST Bypass Blocked (Owner Decision #1):** Call Branch A REST `PATCH /leave_requests` directly with a Branch A/Central `authenticated` JWT and verify `42501` (`REVOKE UPDATE`) + fail-closed `leave_deny_direct_update` RLS policy | PG17 Integration |
| `GAP-09` | **MEDIUM** | **Central `JWKS` Rotation, 503 Outage & Concurrency:** Test unknown `kid` -> forced JWKS refresh -> `200`, expired JWKS + upstream 500 -> `503 JWKS_UNAVAILABLE`, concurrent expiry stampede, and missing-`kid` multi-key behavior | Unit (`central-jwt.ts`) |
| `GAP-10` | **MEDIUM** | **`NonceStore` `'out:'` Prefix Fix & Bounds:** Verify `issueOutboundNonce` collision check and boundary behavior at `maxEntries` | Unit (`nonce-store.ts`) |
| `GAP-11` | **LOW** | **`BRANCH_HR` Role Blocking & Multi-Employee Conflict (`409`):** Verify `BRANCH_HR` fails `403` on both `/decide` and `/admin`, and `>1` active `employees` rows fail `409 DUPLICATE_EMPLOYEE_IDENTITY` | Unit (`leave-service-http.test.ts` / `identity-resolver.test.ts`) |
| `GAP-12` | **LOW** | **Negative Payload Edge Cases (`app.ts`, `leave-schemas.ts`):** Oversized body (`> 32 KiB -> 413`), malformed JSON (`400`), `decision: 'APPROVED'` + non-null `rejection_reason`, `end_date < start_date`, `CORRECTION` with explicit `rejection_reason: null` | Unit |

*(Note: Full mapping back to Phase 3.12A `TC-01`..`TC-22` must be executed during Phase 3.12C/3.12D once SQL v2.7 and Gateway remediations are in place.)*
