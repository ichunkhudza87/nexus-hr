# Phase 3.12D.3 — Gateway-to-SQL Contract Parity Report

**Date:** 2026-11-12  
**Compared Sources:**
- `gateway/src/security/hmac-signer.ts`, `gateway/src/clients/branch-rpc-client.ts`, `gateway/src/validation/leave-schemas.ts`, `gateway/src/errors/gateway-error.ts`, `gateway/src/auth/identity-resolver.ts`, `gateway/src/security/nonce-store.ts`
- `supabase/remediation/v2.7.1/001_branch_a_security_remediation_v2_7_1.sql`

---

## 1. Contract Parity Matrix

| Contract Dimension | Gateway Implementation | SQL v2.7.1 Implementation | Parity |
| :--- | :--- | :--- | :--- |
| **Canonical HMAC v2.7 string (12 fields)** | `buildCanonicalActorPayload()` (`hmac-signer.ts:L72-L87`): `v2.7\|keyId\|actionScope\|targetId\|operationMode\|actorUserId\|email\|actorRole\|branchId\|employeeId\|exp\|nonce` | `verify_gateway_actor()` (`001_..._v2_7_1.sql:L396-L409`): `concat_ws('\|', 'v2.7', v_key_rec.key_id, ...)` | **MATCH** |
| **`keyId` transmission** | `p_key_id: envelope.keyId` (`branch-rpc-client.ts:L100, L134`) | `p_key_id TEXT` exact lookup (`L275, L374-L376`) | **MATCH** |
| **Key lifecycle (active, revoked, expired)** | `getActiveKey()` rejects `!isActive`, `revokedAt !== null`, `isKeyExpired` (`hmac-signer.ts:L162-L168`) | Rejects `revoked_at IS NOT NULL`, `is_active IS NOT TRUE`, `expires_at <= now()` (`L381-L389`) | **MATCH** |
| **`p_set_*` tri-state flags** | `input.rejectionReason !== undefined`, `input.approvedBy !== undefined`, `input.approvedAt !== undefined` (`branch-rpc-client.ts:L128-L130`) | `p_set_rejection_reason`, `p_set_approved_by`, `p_set_approved_at` (`L973-L975, L1056-L1081`) | **MATCH** |
| **SQLSTATE -> HTTP mapping** | `mapPostgrestError()` (`gateway-error.ts:L24-L54`): `42501->403`, `P0002->404`, `23514/22023/22P02->422`, `23505/23503/P0001->409`, `55000->503` | Raises `42501`, `P0002`, `23514`, `22023`, `23503`, `55000` | **MATCH** |
| **Nonce format & TTL** | CSPRNG UUIDv4 lowercase, `1..120s` (`nonce-store.ts:L36-L48`) | `p_nonce UUID`, `0 <= (p_exp - v_now_epoch) <= 120` (`L366-L371`) | **MATCH** |
| **Client-controlled actor fields** | `FORBIDDEN_ACTOR_KEYS` (`leave-schemas.ts:L15-L38`) rejects all `actor_*` / `p_*` keys | `verify_gateway_actor()` trusts only `service_role` + HMAC-verified parameters | **MATCH** |
| **`SUPERADMIN` `branch_id` edge case** | `IdentityResolver` (`identity-resolver.ts:L47-L60`) forwards `profile.branch_id` as-is for `SUPERADMIN` without checking `expectedBranchAId` | `verify_gateway_actor()` (`L460-L462`) rejects any non-NULL `p_branch_id` that is not Branch A (`42501`) | **INFO (`D3-01`)** *(Fail-closed)* |
