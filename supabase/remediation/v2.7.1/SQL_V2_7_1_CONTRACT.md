# SQL Remediation v2.7.1 — Security & RPC Contract

**Date:** 2026-11-12  
**Branch A Ref:** `uneycmbqqpkifwhwzbes`  
**Central Ref:** `wcmevigbqsmzsdqidjel`

---

## 1. RPC-Only Leave Mutation Contract

1. Direct `UPDATE`, `DELETE`, and `TRUNCATE` on `public.leave_requests` are revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`.
2. Direct `INSERT` on `public.leave_requests` is revoked from `PUBLIC`, `anon`, and `service_role` (`authenticated` retains `INSERT` strictly for `leave_self_submit` RLS).
3. All leave decisions and `SUPERADMIN` corrections MUST go through `SECURITY DEFINER` RPCs owned by `postgres`:
   - `public.rpc_branch_decide_leave_request(...)` (12 args, `BRANCH_MANAGER` + `DECISION` only)
   - `public.rpc_superadmin_update_leave_request(...)` (24 args, `SUPERADMIN` + `DECISION` or `CORRECTION`)
4. `public.audit_logs` is strictly append-only via `SECURITY DEFINER` triggers (`record_branch_audit_log()`); `INSERT, UPDATE, DELETE, TRUNCATE` are revoked from `PUBLIC, anon, authenticated, service_role`.

---

## 2. HMAC Envelope & `verify_gateway_actor()` Contract (12 Args)

Canonical payload (12 pipe-delimited fields, UTF-8, HMAC-SHA256):
`v2.7|{key_id}|{action_scope}|{target_id}|{operation_mode}|{actor_user_id}|{actor_email}|{actor_role}|{branch_id}|{employee_id}|{exp}|{nonce}`

- **TTL:** `0 <= (exp - now_epoch) <= 120` seconds.
- **Key Lookup:** Exact match on `nexus_internal.gateway_signing_keys.key_id`; rejects unknown, inactive, revoked, expired, or `< 32` byte secrets.
- **Replay Protection:** Atomic `INSERT INTO nexus_internal.used_actor_nonces ... ON CONFLICT (nonce) DO NOTHING RETURNING nonce`.
- **Target Rollback Semantics:** If `target_id` is missing (`P0002`), the entire transaction rolls back (including `used_actor_nonces`); this is safe because the HMAC signature binds to that exact `target_id` and `exp <= 120s`.
- **Maintenance Cleanup (`D1-04`):** `nexus_internal.cleanup_expired_actor_nonces(p_batch_size)` is executed ONLY by controlled scheduled maintenance (`postgres` / `pg_cron`), deleting expired nonces (`expires_at < now() - 5 minutes`) and stale `tx_actor_context` rows (`verified_at < now() - 5 minutes`) using `FOR UPDATE SKIP LOCKED`.

---

## 3. `SUPERADMIN` `CORRECTION` Deterministic Approval Metadata Rule (`D1-03`)

| Transition / Scenario | `p_set_approved_by` | `p_set_approved_at` | Resulting `approved_by` / `approved_at` |
| :--- | :--- | :--- | :--- |
| `PENDING -> APPROVED` | `FALSE` | `FALSE` | Auto-populated: `actor_user_id` / `now()` |
| `PENDING -> REJECTED` | `FALSE` | `FALSE` | Auto-populated: `actor_user_id` / `now()` (requires `rejection_reason`) |
| `APPROVED -> REJECTED` | `FALSE` | `FALSE` | Preserves existing `approved_by` / `approved_at` (requires `rejection_reason`) |
| `REJECTED -> APPROVED` | `FALSE` | `FALSE` | Preserves existing `approved_by` / `approved_at` (`rejection_reason` preserved unless `p_set_rejection_reason = TRUE`) |
| `CORRECTION` without status change | `FALSE` | `FALSE` | Preserves existing `approved_by` / `approved_at` |
| Explicit metadata correction | `TRUE` (non-NULL) | `TRUE` (non-NULL) | Sets caller-supplied `p_approved_by` / `p_approved_at` |
| Explicit `NULL` on `APPROVED`/`REJECTED` | `TRUE` (`NULL`) | `TRUE` (`NULL`) | **Rejected (`23514`)** — decided rows require approver metadata |
| Explicit `NULL` on `PENDING` | `TRUE` (`NULL`) | `TRUE` (`NULL`) | Clears `approved_by` / `approved_at` to `NULL` |
