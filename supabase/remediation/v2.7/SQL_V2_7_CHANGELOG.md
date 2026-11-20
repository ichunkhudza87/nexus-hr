# NEXUS HR — SQL REMEDIATION V2.7 CHANGELOG

**Supersedes:** `docs/architecture/phase_3_12a/PHASE_3_12A_REMEDIATION_V2_6.sql`  
**Phase:** 3.12C (Draft Only — Not Executed)

---

## Summary of Changes from v2.6 -> v2.7

1. **Multi-Key HMAC Rotation, Expiration & Revocation (`F-01` / `B-1`):**
   - Extended `nexus_internal.gateway_signing_keys` with `activated_at`, `expires_at`, `revoked_at`, `chk_gateway_signing_key_id_format` (`^[A-Za-z0-9._-]{1,64}$`), `chk_gateway_signing_key_secret_len` (`>= 32` bytes), and `chk_gateway_signing_key_state` (`revoked_at IS NULL OR is_active = FALSE`).
   - Added `key_id` column to `nexus_internal.tx_actor_context`.
   - Upgraded `nexus_internal.verify_gateway_actor()` from 11 to **12 parameters** (`p_key_id TEXT` prepended), removed the blind `ORDER BY created_at DESC LIMIT 1` fallback, and enforced exact active/unrevoked/unexpired key lookup by `p_key_id`.
   - Upgraded canonical payload from v2.6 (10 fields) to **v2.7 (12 fields)**: `'v2.7'|key_id|...`.
   - Upgraded `public.rpc_branch_decide_leave_request` (12 parameters) and `public.rpc_superadmin_update_leave_request` (24 parameters) with `p_key_id`.

2. **Tri-State `SUPERADMIN` Partial `CORRECTION` Semantics (`F-02` / `B-2`):**
   - Added `p_set_rejection_reason`, `p_set_approved_by`, and `p_set_approved_at` boolean flags (`DEFAULT FALSE`) to `public.rpc_superadmin_update_leave_request`.
   - Preserves existing `rejection_reason`, `approved_by`, and `approved_at` whenever omitted (`p_set_* = FALSE`), clears or sets only when explicitly passed (`p_set_* = TRUE`), and validates all final resulting row invariants & SQL CHECK constraints before writing.
   - Strengthened `enforce_leave_decision_integrity()` to validate resulting row dates, `total_days`, non-blank `reason`, and `REJECTED` reason invariant across all `leave_requests` updates, and locked `DECISION` approver metadata to `v_ctx.actor_user_id` / `now()`.

3. **Privilege & Defense-in-Depth RLS Alignment (`F-03`, `F-07` / `B-3`):**
   - Retained `REVOKE UPDATE, DELETE ON public.leave_requests FROM PUBLIC, anon, authenticated`.
   - Added explicit **RESTRICTIVE** deny-all policy `"leave_deny_direct_update" AS RESTRICTIVE FOR UPDATE TO authenticated USING (FALSE) WITH CHECK (FALSE)` so `UPDATE` remains blocked even if a permissive policy is mistakenly added later, without affecting permissive `SELECT`/`INSERT` policies.
   - Hardened `verify_gateway_actor()` transport check (`current_setting('role', true) = 'service_role'` + JWT claim `'role' = 'service_role'`), scope-to-role matching (`BRANCH_MANAGER` only for `LEAVE_DECIDE`; `SUPERADMIN` only for `LEAVE_SUPERADMIN_UPDATE`), actor email pipe/newline guard, branch config `is_active` check, and same-branch target record verification in `public.leave_requests` JOIN `public.employees`.
   - Hardened `enforce_leave_decision_integrity()` to reject ANY direct `leave_requests` `UPDATE` lacking a valid `nexus_internal.tx_actor_context` row (closing direct `authenticated` or raw `service_role` bypasses uniformly).

4. **Bounded Concurrency-Safe Nonce Cleanup (`F-07` / `B-3.D`):**
   - Replaced unconditional per-call `DELETE FROM nexus_internal.used_actor_nonces` with `nexus_internal.cleanup_expired_actor_nonces(p_batch_size INTEGER DEFAULT 250)` using `ORDER BY expires_at ASC LIMIT ... FOR UPDATE SKIP LOCKED` (never touches unexpired nonces) plus ~5% sampled bounded cleanup (`LIMIT 50`) on RPC calls.

5. **Branch A Baseline Remediation Carryover:**
   - Retains `seq_branch_a_employee_code` `MAXVALUE 999999999999 NO CYCLE`, `generate_employee_code()` formatting beyond `10000`, fail-fast `emit_employee_outbox_event()`, deterministic BEFORE trigger ordering (`trg_01_*`, `trg_02_*`, `trg_03_*`), and strict `REVOKE ALL` / `GRANT EXECUTE ... TO service_role` function privilege model.
   - Preserves Central seed (`BRANCH-A`, `00000000-0000-0000-0000-000000000001`, `Branch A - Jakarta`, `Asia/Jakarta`) in `002_central_seed_and_rollback_v2_7.sql`.
