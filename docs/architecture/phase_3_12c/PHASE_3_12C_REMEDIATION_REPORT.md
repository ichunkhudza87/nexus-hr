# NEXUS HR — PHASE 3.12C REMEDIATION REPORT
**Role:** Senior Backend Security Engineer, PostgreSQL Security Architect & DevSecOps Engineer  
**Workspace:** `D:\Antigravity_Projects\nexus-hr`  
**Audit Baseline:** Phase 3.12B.1 Findings (`F-01`..`F-09`)  
**Mode:** LOCAL CODE REMEDIATION, LOCAL TESTING & SQL V2.7 DRAFTING ONLY

---

## 1. Executive Summary

All confirmed Phase 3.12B.1 findings blocking progression past Phase 3.12B.1 have been remediated locally in the Backend API Gateway (`gateway/src/`) and aligned with the newly created **SQL Remediation v2.7 Draft** (`supabase/remediation/v2.7/`):

- **`B-1` (`F-01` HIGH) — HMAC Key ID, Rotation & Revocation:** Implemented `v2.7` 12-field canonical HMAC contract binding `key_id`, propagated `p_key_id` across `HttpBranchAClient` and SQL v2.7 RPCs/verifier, added `activated_at` and `expires_at` grace-window support alongside `revoked_at` and `is_active`, and prevented silent key fallback.
- **`B-2` (`F-02` HIGH) — `SUPERADMIN` Partial `CORRECTION` Semantics:** Added explicit tri-state field-presence booleans (`p_set_rejection_reason`, `p_set_approved_by`, `p_set_approved_at`) in Gateway + SQL v2.7 `rpc_superadmin_update_leave_request`, rejected explicit `null` on NOT NULL columns (`status`, `employee_id`, `leave_type`, `start_date`, `end_date`, `total_days`, `reason`), preserved existing metadata on omitted keys, and validated final resulting row invariants & SQL CHECK constraints.
- **`B-3` (`F-03`, `F-07` MEDIUM-HIGH) — Privilege, RLS & Nonce Cleanup Alignment:** Created SQL v2.7 draft enforcing RPC-only leave mutations (`REVOKE UPDATE, DELETE` + `RESTRICTIVE` deny-all `FOR UPDATE` policy `leave_deny_direct_update`), hardened transport/scope/role/branch/target-record validation in `nexus_internal.verify_gateway_actor()`, hardened `enforce_leave_decision_integrity()` for both `BRANCH_MANAGER` and `SUPERADMIN`, and replaced unbounded per-call `DELETE` with concurrency-safe bounded `cleanup_expired_actor_nonces(p_batch_size)` (`FOR UPDATE SKIP LOCKED`).
- **`B-4` (`F-06` LOW) — NonceStore Collision Prefix Fix:** Fixed `NonceStore.issueOutboundNonce()` lookup from bare `nonce` to `out:${nonce}`, guarded `'out'` namespace isolation, and verified collision/expiry/pruning/concurrency behavior.
- **Conditional Hardening (`F-04`, `F-05` MEDIUM):** Implemented single-flight JWKS refresh lock (including waiting on in-flight refresh during concurrent unknown-`kid` misses), per-`kid` cooldown throttling, and multi-key candidate evaluation when JWT omits `kid` in `CentralJwtVerifier`; moved optional `X-Request-Nonce` consumption after bearer JWT verification in `app.ts` to prevent unauthenticated `NonceStore` eviction, and explicitly documented `NonceStore`'s single-process local scope.

---

## 2. Finding-by-Finding Remediation Disposition

| Finding | Severity | Remediation Implemented | Modified / Draft Files | Verification Evidence |
|---|---|---|---|---|
| `F-01` (`B-1`) | HIGH | Added `v2.7` 12-field canonical format (`'v2.7'\|key_id\|...`), `p_key_id` wire propagation, `activated_at`/`expires_at`/`revoked_at` key lifecycle | `hmac-signer.ts`, `domain.ts`, `env.ts`, `branch-rpc-client.ts`, `.env.example`, `001_branch_a_security_remediation_v2_7.sql` | Unit tests + local HTTP wire test (`npm test`: `32/32` pass) |
| `F-02` (`B-2`) | HIGH | Tri-state field-presence flags (`p_set_*`) + NOT NULL `null` rejection + SQL resulting-row validation & trigger checks | `leave-schemas.ts`, `branch-rpc-client.ts`, `001_branch_a_security_remediation_v2_7.sql` | Mocked E2E HTTP tests + wire serialization tests |
| `F-03` (`B-3.A/C`) | MED-HIGH | `REVOKE UPDATE`, `AS RESTRICTIVE` `leave_deny_direct_update` policy, direct-UPDATE block in `enforce_leave_decision_integrity()` | `001_branch_a_security_remediation_v2_7.sql` | Static SQL review (Live PG execution: **NOT VERIFIED** locally) |
| `F-07` (`B-3.B/D`) | MEDIUM | Scope-strict roles, branch/target checks, `cleanup_expired_actor_nonces()` with `SKIP LOCKED` | `001_branch_a_security_remediation_v2_7.sql` | Static SQL review (Live PG execution: **NOT VERIFIED** locally) |
| `F-06` (`B-4`) | LOW | Fixed `'out:' + nonce` collision check & added namespace isolation | `nonce-store.ts` | Collision, isolation, expiry & concurrent unit tests |
| `F-04` | MEDIUM | Single-flight JWKS lock (`inFlightRefresh`), per-`kid` throttle, omitted-`kid` candidate verification | `central-jwt.ts` | Concurrent rotation & omitted-`kid` tests (`fetchCount` assertions) |
| `F-05` | MEDIUM | JWT verification ordered before `X-Request-Nonce` consumption; single-process scope explicitly documented | `app.ts`, `nonce-store.ts` | E2E replay (`409`) & code inspection |
| `F-08` | LOW | Explicit calendar date validation, non-empty `CORRECTION` check, explicit `rejection_reason: null` rejection with `REJECTED` | `leave-schemas.ts` | Schema validation & E2E correction tests |
| `F-09` | LOW | Explicit UTF-8 string parity instructions documented in `.env.example` & SQL contract | `.env.example`, `SQL_V2_7_CONTRACT.md` | Config load & unit parity check |

---

## 3. Baseline Safety Notes

- Pre-remediation backup created and verified (20 files) at `docs/architecture/phase_3_12c/pre_remediation_backup/`.
- Baseline migrations `supabase/migrations/001_central_schema.sql` and `supabase/migrations/002_branch_a_schema.sql` remain unmodified.
- No remote Supabase queries, migrations, RPC calls, secret generation, or deployments were performed.
