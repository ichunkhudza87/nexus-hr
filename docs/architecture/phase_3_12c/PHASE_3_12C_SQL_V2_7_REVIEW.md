# NEXUS HR — PHASE 3.12C SQL V2.7 TECHNICAL REVIEW

**Reviewed Drafts:**
- `supabase/remediation/v2.7/001_branch_a_security_remediation_v2_7.sql`
- `supabase/remediation/v2.7/002_central_seed_and_rollback_v2_7.sql`
- `supabase/remediation/v2.7/SQL_V2_7_CHANGELOG.md`
- `supabase/remediation/v2.7/SQL_V2_7_CONTRACT.md`
- `supabase/remediation/v2.7/SQL_V2_7_ROLLBACK_PLAN.md`

---

## 1. Security & Integrity Verification Checklist

### A. Privilege & RLS Model
- **Primary Mutation Lock:** `REVOKE UPDATE, DELETE ON TABLE public.leave_requests FROM PUBLIC, anon, authenticated;` ensures untrusted roles cannot mutate `leave_requests` directly.
- **RESTRICTIVE RLS Policy Combination Analysis:**
  - Existing permissive policies retained from `002_branch_a_schema.sql`: `"leave_select" FOR SELECT TO authenticated` and `"leave_self_submit" FOR INSERT TO authenticated`.
  - Legacy `"leave_manager_decide"` permissive policy is dropped.
  - Added `"leave_deny_direct_update" ON public.leave_requests AS RESTRICTIVE FOR UPDATE TO authenticated USING (FALSE) WITH CHECK (FALSE);`.
  - **Combination Verification:** Because `"leave_deny_direct_update"` is `AS RESTRICTIVE` and scoped strictly to `FOR UPDATE`, PostgreSQL intersects (`AND`) it with any `FOR UPDATE` / `FOR ALL` policy, guaranteeing `FALSE` even if a permissive update policy is later added — while leaving `SELECT` and `INSERT` policies completely unaffected.
- **Function Execution Exposure:**
  - `nexus_internal.verify_gateway_actor` (12 args) and `nexus_internal.cleanup_expired_actor_nonces` (1 arg) are `SECURITY DEFINER`, owned by `postgres`, with `EXECUTE` revoked from `PUBLIC, anon, authenticated, service_role`.
  - Legacy v2.6 overloads (`verify_gateway_actor` 11 args, `rpc_branch_decide_leave_request` 11 args, `rpc_superadmin_update_leave_request` 20 args) are explicitly dropped via `DROP FUNCTION IF EXISTS` so no insecure overload remains callable.
  - Only `public.rpc_branch_decide_leave_request` (12 args) and `public.rpc_superadmin_update_leave_request` (24 args) are granted `EXECUTE` to `service_role`.

### B. `verify_gateway_actor()` Fail-Closed Review
Verified all 11 mandatory checks are enforced fail-closed before populating `nexus_internal.tx_actor_context`:
1. Transport check requires `current_setting('role', true) = 'service_role'` and JWT claims `'role' = 'service_role'` under `authenticator` (or `session_user = 'postgres'`).
2. Format check on `p_key_id`, `p_action_scope`, `p_operation_mode`, non-null `p_target_id`, `p_actor_user_id`, sanitized `p_actor_email` (no `|`, `\r`, `\n`), `p_exp`, `p_nonce`, and 64-hex `p_actor_sig`.
3. Strict role scope allow-list: `NULL` or non-permitted roles fail closed; `LEAVE_DECIDE` requires `BRANCH_MANAGER` + `DECISION`; `LEAVE_SUPERADMIN_UPDATE` requires `SUPERADMIN`.
4. Expiration check: rejects expired (`p_exp < v_now_epoch`) and over-long (`p_exp - v_now_epoch > 120`).
5. Exact `key_id` lookup: distinguishes unknown (`42501`), revoked (`42501`), inactive (`42501`), expired grace-window (`42501`), and `<32`-byte secret (`55000`); never falls back to another active key.
6. 12-field canonical v2.7 string + HMAC-SHA256 digest comparison (`extensions.digest` equality).
7. Atomic single-use nonce claim via `INSERT ... ON CONFLICT (nonce) DO NOTHING`.
8. Active Branch A check on `public.branch_config` (`id = 00000000-0000-0000-0000-000000000001`, `is_active = TRUE`).
9. `BRANCH_MANAGER` employee check (`user_auth_id`, `is_active = TRUE`, `is_deleted = FALSE`).
10. Target leave request existence & Branch A membership check (`public.leave_requests` JOIN `public.employees`).
11. `tx_actor_context` scoped to `pg_current_xact_id()`, deleted on both RPC return and exception rollback.

### C. Nonce Ledger Cleanup Concurrency & Safety
- `cleanup_expired_actor_nonces(p_batch_size)` strictly filters `WHERE expires_at < now() - INTERVAL '5 minutes'`, caps batch size `1..1000`, orders by `expires_at ASC`, and locks candidates via `FOR UPDATE SKIP LOCKED`.
- Unexpired nonces (plus a 5-minute buffer beyond max 120s TTL) are never deleted by cleanup.
- Opportunistic call runs only on ~5% of RPCs (`LIMIT 50`) without blocking incoming nonce insertions; production cron cadence is documented in `SQL_V2_7_CONTRACT.md` without scheduling any jobs now.

### D. Partial `CORRECTION` & Trigger Invariants
- `rpc_superadmin_update_leave_request` computes `v_next_*` preserving omitted fields, validates `end_date >= start_date`, `total_days > 0`, non-blank `reason`, and `REJECTED => non-empty rejection_reason` BEFORE executing `UPDATE`, and `trg_01_enforce_leave_decision` enforces final resulting row invariants and lock-out of direct `UPDATE` without `tx_actor_context`.
- `record_branch_audit_log()` runs `AFTER UPDATE` using `OLD` and `NEW` row snapshots, ensuring audit logs reflect actual persisted database changes and roll back atomically on trigger/constraint failure.

---

## 2. Static Parsing & Execution Caveats

- `psql` is **not installed** in the local environment, so `001_branch_a_security_remediation_v2_7.sql` and `002_central_seed_and_rollback_v2_7.sql` were verified through manual DDL/PLpgSQL/signature inspection rather than live `psql` execution.
- Live PostgreSQL 17 parse + transactional dry-run validation MUST execute in Phase 3.12D / pre-production staging before applying remotely to `nexus-branch-a` (`uneycmbqqpkifwhwzbes`) or `nexus-central` (`wcmevigbqsmzsdqidjel`).
