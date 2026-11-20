# Phase 3.12D.2 — Security Regression Report (Static Review)

**Date:** 2026-11-12  
**Scope:** Static security review of `supabase/remediation/v2.7.1/` (Section 9 checklist)

---

## 1. Security Checklist (Static Verification Only — Live PG17 Execution NOT VERIFIED)

| Security Control | v2.7.1 Static Verification | Status |
| :--- | :--- | :--- |
| **`SECURITY DEFINER` `search_path` safety** | Every `SECURITY DEFINER` function explicitly sets `SET search_path = ..., pg_temp` with `pg_temp` last and uses schema-qualified object names; zero dynamic `EXECUTE`. | **PASS (Static)** |
| **Function ownership** | All functions explicitly `ALTER FUNCTION ... OWNER TO postgres`. | **PASS (Static)** |
| **Default `PUBLIC` `EXECUTE` privileges** | `ALTER DEFAULT PRIVILEGES` in `nexus_internal` revokes all from `PUBLIC, anon, authenticated, service_role`; all `public` RPCs & trigger functions revoke `PUBLIC, anon, authenticated` (and trigger functions also revoke `service_role`). | **PASS (Static)** |
| **Direct DML bypasses (`D1-01`)** | `leave_requests` revokes `INSERT, UPDATE, DELETE, TRUNCATE` from `service_role` and `UPDATE, DELETE, TRUNCATE` from `authenticated`; `audit_logs` revokes `INSERT, UPDATE, DELETE, TRUNCATE` from `PUBLIC, anon, authenticated, service_role`; `BEFORE DELETE` & `BEFORE TRUNCATE` triggers added. | **PASS (Static)** |
| **RLS & privilege interaction** | `leave_deny_direct_update` (`AS RESTRICTIVE FOR UPDATE TO authenticated`) coexists with `leave_select` (`FOR SELECT`) and `leave_self_submit` (`FOR INSERT`); `service_role` `BYPASSRLS` is neutralized by table-level `REVOKE`. | **PASS (Static)** |
| **HMAC key lookup & rotation** | Exact `key_id` lookup, `revoked_at IS NULL`, `is_active IS TRUE`, `expires_at > now()`, `octet_length >= 32`, zero fallback, `nexus_internal` inaccessible to `service_role`. | **PASS (Static)** |
| **Actor identity & context** | `tx_actor_context` scoped to `pg_current_xact_id()`, `key_id VARCHAR(64) NOT NULL` (`D1-02`), deleted on return & exception. | **PASS (Static)** |
| **Nonce replay protection** | Single-use `ON CONFLICT (nonce) DO NOTHING RETURNING nonce`; cleanup moved out of RPC path (`D1-04`). | **PASS (Static)** |
| **Audit log integrity** | `trg_audit_leave_requests` covers `AFTER INSERT OR UPDATE OR DELETE`; `record_branch_audit_log()` is `SECURITY DEFINER`. | **PASS (Static)** |
| **Employee code & outbox** | `seq_branch_a_employee_code` `MAXVALUE 999999999999 NO CYCLE`; fail-fast `employee_code` check in `emit_employee_outbox_event()`; deterministic `trg_01_*`..`trg_03_*`. | **PASS (Static)** |
| **SQLSTATE correctness & rollback** | `42501` auth/privilege, `22023` invalid param, `23514` check/invariant, `23503` FK/deleted employee, `P0002` not found. | **PASS (Static)** |
