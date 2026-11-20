# SQL Remediation v2.7.1 — Changelog

**Date:** 2026-11-12  
**Supersedes:** `supabase/remediation/v2.7/` (preserved unmodified)  
**Target:** Branch A (`uneycmbqqpkifwhwzbes`) & Central (`wcmevigbqsmzsdqidjel`)

---

## Summary of Changes from v2.7 to v2.7.1

| Finding | Category | Change in v2.7.1 |
| :--- | :--- | :--- |
| **`D1-01`** | **CRITICAL Security** | Revoked `INSERT, UPDATE, DELETE, TRUNCATE` on `public.leave_requests` and `public.audit_logs` from `service_role` (retaining `SELECT` only). Revoked `TRUNCATE` on all `public` tables from `service_role` and `authenticated`. Revoked `UPDATE, DELETE, TRUNCATE` on `public.leave_requests` from `authenticated` (preserving `SELECT, INSERT` for `leave_self_submit` RLS). Added `prevent_hard_delete_leave_requests()` (`BEFORE DELETE`) and `prevent_truncate_protected_tables()` (`BEFORE TRUNCATE`) triggers. Extended `trg_audit_leave_requests` to `AFTER INSERT OR UPDATE OR DELETE`. Revoked `EXECUTE` on trigger functions from `service_role`. |
| **`D1-02`** | **HIGH Schema Drift** | Added safe upgrade handling for `nexus_internal.tx_actor_context.key_id`: inspects existing `NULL` rows, fails safely if active/recent (`< 5m`) `NULL` rows exist, deletes only stale orphaned rows (`> 5m`), enforces `ALTER COLUMN key_id SET NOT NULL`, and verifies `character varying(64)` + `NOT NULL` via `pg_attribute` post-migration assertion. |
| **`D1-03`** | **MEDIUM Logic / Audit** | Added deterministic `CORRECTION` approval metadata rule in `rpc_superadmin_update_leave_request()` and `enforce_leave_decision_integrity()`: transitioning `PENDING -> APPROVED/REJECTED` with omitted flags auto-populates `approved_by = actor_user_id` and `approved_at = now()`; explicit `NULL` for `approved_by`/`approved_at` on `APPROVED`/`REJECTED` rows is rejected (`23514`); existing metadata is preserved when already decided. |
| **`D1-04`** | **LOW/MEDIUM Operations** | Removed probabilistic 5% `cleanup_expired_actor_nonces(50)` call from `verify_gateway_actor()` primary RPC path. Retained `nexus_internal.cleanup_expired_actor_nonces(INTEGER)` (`FOR UPDATE SKIP LOCKED`, `OWNER TO postgres`) for controlled scheduled maintenance (e.g., `pg_cron`). Documented `P0002` transaction rollback behavior. |
| **Central** | **Header Alignment** | Updated `002_central_seed_and_rollback_v2_7_1.sql` header to `v2.7.1`; preserved canonical `BRANCH-A` seed, conflict guards, post-seed assertion, and `FOR UPDATE` 4-table rollback check. |
