# NEXUS HR — PHASE 3.12B.1 READINESS DECISION
**Phase:** 3.12B.1 — Read-Only Gateway Source Code Security Audit  
**Workspace:** `D:\Antigravity_Projects\nexus-hr`  
**Audit Date:** 2026-11-11

---

## FINAL DECISION

# **NOT READY — REMEDIATION REQUIRED**

Although the Phase 3.12B Backend API Gateway demonstrates strong cryptographic authentication (`CentralJwtVerifier`), authoritative directory resolution (`IdentityResolver`), strict payload allow-listing (`leave-schemas.ts`), sanitized logging (`log-sanitizer.ts`), and `24/24` passing local unit tests (under mocked DB boundaries), it **cannot proceed directly to Phase 3.12C SQL Remediation or remote deployment** until **two High-severity Gateway <-> DB contract defects** and **the SQL v2.7 alignment items** are resolved together.

---

## 1. Release-Blocking Items (Must Fix Before Phase 3.12C Authorization)

| Blocker | Description | Owner Scope |
|---|---|---|
| **`B-1` (`F-01`)** | Align HMAC Key Rotation & Revocation across Gateway & SQL v2.7: add `revoked_at` to `nexus_internal.gateway_signing_keys`, accept `p_key_id` in RPCs & `verify_gateway_actor()`, bind `key_id` inside the canonical payload (`11` fields), and transmit `p_key_id` from `HttpBranchAClient` | Gateway + SQL v2.7 |
| **`B-2` (`F-02`)** | Fix `SUPERADMIN` partial `CORRECTION` null-overwrite bug: add `p_set_rejection_reason`, `p_set_approved_by`, `p_set_approved_at` boolean presence flags in SQL v2.7 `rpc_superadmin_update_leave_request` and distinguish `undefined` vs `null` in `HttpBranchAClient` & `leave-schemas.ts` | Gateway + SQL v2.7 |
| **`B-3` (`F-03`, `F-07`)** | Finalize **SQL Remediation v2.7** incorporating `B-1`, `B-2`, fail-closed defense-in-depth `leave_deny_direct_update` policy alongside `REVOKE UPDATE`, scope-strict role check inside `verify_gateway_actor()`, and throttled bounded nonce cleanup | SQL v2.7 |
| **`B-4` (`F-06`, `GAP-04`)** | Fix `NonceStore.issueOutboundNonce` `'out:'` prefix check bug and add direct unit tests for `HttpCentralClient`, `HttpBranchAClient` (`p_key_id` + partial `CORRECTION` flags), and `mapPostgrestError` | Gateway |

---

## 2. Recommended Hardening (Conditional / Before Production Scale)

- **`H-1` (`F-04`):** Add single-flight deduplication lock for JWKS refreshes and handle multi-key/missing-`kid` edge cases cleanly in `CentralJwtVerifier`.
- **`H-2` (`F-05`):** Decide single-instance vs multi-instance deployment topology: for multi-replica production, move inbound `NonceStore` to shared Redis/DB store and consider making `X-Request-Nonce` mandatory on write routes.
- **`H-3` (`F-09`):** Include explicit operational rule in out-of-band key provisioning runbook: store identical UTF-8 text (`64`-char hex string) in both `GATEWAY_ACTOR_HMAC_KEY` and `nexus_internal.gateway_signing_keys.hmac_secret`.

---

## 3. Gate Exit Criteria to Enter Phase 3.12C

Phase 3.12C (Final SQL Remediation v2.7 Generation & Staged Remote Verification) may be authorized only after:
1. Owner approves Remediation Specification v2.7 deltas (`B-1`, `B-2`, `B-3`),
2. Gateway patches for `p_key_id` canonical signing, tri-state `CORRECTION` field flags, `NonceStore` `'out:'` fix, and `HttpBranchAClient`/`HttpCentralClient` unit tests pass locally (`0` failures), and
3. Revised SQL v2.7 migration script + rollback script pass schema/canonical parity verification before touching `nexus-branch-a` (`uneycmbqqpkifwhwzbes`).

---

## 4. Phase 3.12B.1 Safety Boundary Verification

- Remote databases (`nexus-central` `wcmevigbqsmzsdqidjel`, `nexus-branch-a` `uneycmbqqpkifwhwzbes`): **UNTOUCHED (No SQL executed)**
- Legacy projects (`bolt`, `cbt`, `nusantara`): **UNTOUCHED**
- Existing Gateway source files (`gateway/src/**`) and SQL migrations (`supabase/migrations/**`): **UNMODIFIED**
- Production HMAC secrets: **NOT generated or exposed**
- Only read-only inspection, local `npm test`, and Phase 3.12B.1 audit report creation under `docs/architecture/phase_3_12b_1/` were performed.
