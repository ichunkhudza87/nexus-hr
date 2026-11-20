# Phase 3.12D.3 — Independent Read-Only Security Audit Report (SQL v2.7.1)

**Date:** 2026-11-12  
**Role:** Independent Senior PostgreSQL Security Auditor & Database Architect  
**Mode:** STRICT READ-ONLY AUDIT  
**Audited Targets:**
- `supabase/remediation/v2.7.1/001_branch_a_security_remediation_v2_7_1.sql` (1300 lines)
- `supabase/remediation/v2.7.1/002_central_seed_and_rollback_v2_7_1.sql` (115 lines)
- `supabase/remediation/v2.7.1/SQL_V2_7_1_*.md`
- `gateway/src/` (`hmac-signer.ts`, `branch-rpc-client.ts`, `leave-service.ts`, `leave-schemas.ts`, `gateway-error.ts`, `identity-resolver.ts`, `nonce-store.ts`)
- `docs/architecture/phase_3_12d_2/`

---

## 1. Executive Summary

An independent line-by-line, read-only audit of **SQL Remediation v2.7.1** confirms that all blocking SQL security and schema-drift defects identified in Phase 3.12D.1 (`D1-01`, `D1-02`, `D1-03`, `D1-04`) have been accurately remediated in the SQL source code, and the Gateway-to-SQL contract is aligned.

**PostgreSQL 17 Execution Status:** **`NOT VERIFIED — POSTGRESQL 17 UNAVAILABLE`** (`where.exe psql docker pg_ctl postgres` returned no binaries). Static inspection does **not** substitute for live PostgreSQL 17 execution; PG17 validation remains mandatory prior to any remote migration execution.

---

## 2. Audit Coverage by Area (Sections 3.A – 3.H)

| Area | Scope | Static Verdict | PG17 Live Execution |
| :--- | :--- | :--- | :--- |
| **A. Effective privilege & `service_role` isolation** | `REVOKE`/`GRANT`, `BYPASSRLS`, RPC `EXECUTE`, `nexus_internal` isolation | **PASS (Static)** | `NOT VERIFIED — POSTGRESQL 17 UNAVAILABLE` |
| **B. `DELETE` & `TRUNCATE` protection** | `prevent_hard_delete_leave_requests()`, `prevent_truncate_protected_tables()`, `trg_audit_leave_requests` (`AFTER INSERT OR UPDATE OR DELETE`) | **PASS (Static)** | `NOT VERIFIED — POSTGRESQL 17 UNAVAILABLE` |
| **C. `SECURITY DEFINER` & actor identity** | `SET search_path = ..., pg_temp`, `OWNER TO postgres`, HMAC + `tx_actor_context`, fail-closed transport checks | **PASS (Static)** | `NOT VERIFIED — POSTGRESQL 17 UNAVAILABLE` |
| **D. `tx_actor_context.key_id` migration safety** | Fresh `NOT NULL`, upgrade `ADD COLUMN IF NOT EXISTS`, 5m stale-only cleanup, `pg_attribute` post-check | **PASS (Static)** | `NOT VERIFIED — POSTGRESQL 17 UNAVAILABLE` |
| **E. `SUPERADMIN` correction state machine** | All 10 state-transition, metadata, `NULL`, `rejection_reason`, and rollback scenarios verified | **PASS (Static)** | `NOT VERIFIED — POSTGRESQL 17 UNAVAILABLE` |
| **F. Nonce lifecycle** | Atomic `ON CONFLICT DO NOTHING`, `<= 120s` TTL, `FOR UPDATE SKIP LOCKED` maintenance-only cleanup, rollback on `P0002` | **PASS (Static)** | `NOT VERIFIED — POSTGRESQL 17 UNAVAILABLE` |
| **G. Central seed & rollback** | `wcmevigbqsmzsdqidjel`, `BRANCH-A`, conflict guards, `FOR UPDATE` 4-table check, soft-deactivation | **PASS (Static)** | `NOT VERIFIED — POSTGRESQL 17 UNAVAILABLE` |
| **H. Gateway-to-SQL contract parity** | 12-field HMAC v2.7, `p_key_id`, `p_set_*`, SQLSTATE mapping, `FORBIDDEN_ACTOR_KEYS` | **PASS (Static)** *(1 LOW informational note `D3-01`)* | `NOT VERIFIED — POSTGRESQL 17 UNAVAILABLE` |

---

## 3. Detailed Verification Notes

### B. `DELETE` & `TRUNCATE` Protection Boundaries
- `trg_04_prevent_delete_leave_requests` (`BEFORE DELETE` on `public.leave_requests`) and `trg_05_prevent_truncate_leave_requests` / `trg_01_prevent_truncate_audit_logs` (`BEFORE TRUNCATE`) execute as `SECURITY DEFINER` owned by `postgres` and raise `42501`.
- `trg_audit_leave_requests` (`AFTER INSERT OR UPDATE OR DELETE`) records audit rows for any permitted or superuser `DELETE`.
- **Privilege Boundary:** Primary enforcement for `anon`, `authenticated`, and `service_role` is `REVOKE DELETE, TRUNCATE`. Triggers provide defense-in-depth for application roles, but **do not** prevent a `postgres` superuser or table owner from disabling triggers (`ALTER TABLE ... DISABLE TRIGGER` or `session_replication_role = replica`) or truncating/deleting.

### D. `tx_actor_context.key_id` Retry & Partial-Migration Safety
- Wrapped in `BEGIN; ... COMMIT;` (`L35, L1300`). Any exception in the stale-row check (`L153-L178`) or `pg_attribute` assertion (`L184-L204`) rolls back the entire transaction cleanly, leaving no partial DDL state.

### F. Nonce Transaction Rollback Semantics
- `INSERT INTO nexus_internal.used_actor_nonces` (`L423-L426`) executes inside the RPC transaction. If the subsequent `P0002` target check (`L486`) or `UPDATE` / trigger fails, PostgreSQL rolls back the transaction—including the nonce claim. This is safe because the HMAC signature binds to that exact `p_target_id` and `p_exp <= 120s`.
- Cleanup (`cleanup_expired_actor_nonces`) deletes only `expires_at < now() - INTERVAL '5 minutes'` with `FOR UPDATE SKIP LOCKED` and is no longer invoked probabilistically from `verify_gateway_actor()`.
