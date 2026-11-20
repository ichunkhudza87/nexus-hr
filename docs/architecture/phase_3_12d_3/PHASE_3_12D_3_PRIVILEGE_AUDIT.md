# Phase 3.12D.3 — Independent Privilege Audit (SQL v2.7.1)

**Date:** 2026-11-12  
**PostgreSQL 17 Live Verification:** **`NOT VERIFIED — POSTGRESQL 17 UNAVAILABLE`**

---

## 1. Table & Schema Privilege Verification (`001_branch_a_security_remediation_v2_7_1.sql`)

| Object | `PUBLIC` / `anon` | `authenticated` | `service_role` (`BYPASSRLS`) | `postgres` (Owner) | Lines |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `SCHEMA nexus_internal` | REVOKED | REVOKED | REVOKED | OWNER | `L75-L82` |
| `nexus_internal.gateway_signing_keys` | REVOKED | REVOKED | REVOKED | OWNER | `L113` |
| `nexus_internal.used_actor_nonces` | REVOKED | REVOKED | REVOKED | OWNER | `L125` |
| `nexus_internal.tx_actor_context` | REVOKED | REVOKED | REVOKED | OWNER | `L209` |
| `public.leave_requests` | REVOKED (`L1154, L1157`) | `SELECT, INSERT` only (`UPDATE, DELETE, TRUNCATE` revoked `L1158` + `RESTRICTIVE` `FOR UPDATE` policy `L1140-L1146`) | **`SELECT` ONLY** (`INSERT, UPDATE, DELETE, TRUNCATE` revoked `L1157`) | OWNER | `L1140-L1158` |
| `public.audit_logs` | REVOKED (`L1154, L1160`) | `SELECT` only (`INSERT, UPDATE, DELETE, TRUNCATE` revoked `L1160`) | **`SELECT` ONLY** (`INSERT, UPDATE, DELETE, TRUNCATE` revoked `L1160`) | OWNER | `L1154-L1160` |
| All `public` tables (`TRUNCATE`) | REVOKED | REVOKED | REVOKED | OWNER | `L1155` |

**Assessment:** `service_role` cannot directly `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE` `public.leave_requests` or `public.audit_logs`, nor read `nexus_internal.*`. Because `rpc_branch_decide_leave_request` and `rpc_superadmin_update_leave_request` (and `record_branch_audit_log`) are `SECURITY DEFINER` owned by `postgres`, legitimate RPC mutations and audit inserts continue to function without granting direct table DML to `service_role`.

---

## 2. Function `EXECUTE` Privilege Verification

| Function | `PUBLIC`/`anon`/`authenticated` | `service_role` | Owner & `search_path` | Lines |
| :--- | :--- | :--- | :--- | :--- |
| `nexus_internal.cleanup_expired_actor_nonces(INTEGER)` | REVOKED | REVOKED | `postgres` / `nexus_internal, pg_temp` | `L221-L265` |
| `nexus_internal.verify_gateway_actor(...)` (12 args) | REVOKED | REVOKED | `postgres` / `nexus_internal, public, extensions, pg_temp` | `L290-L520` |
| `public.rpc_branch_decide_leave_request(...)` (12 args) | REVOKED | **GRANTED** | `postgres` / `nexus_internal, public, pg_temp` | `L900-L956` |
| `public.rpc_superadmin_update_leave_request(...)` (24 args) | REVOKED | **GRANTED** | `postgres` / `nexus_internal, public, pg_temp` | `L987-L1131` |
| All trigger functions (`record_branch_audit_log`, `enforce_leave_decision_integrity`, `prevent_hard_delete_leave_requests`, `prevent_truncate_protected_tables`, `emit_*`, `generate_employee_code`, etc.) | REVOKED | **REVOKED** | `postgres` / explicit `pg_temp` | `L1279-L1292` |
| `public.get_auth_role()`, `public.get_current_employee_id()` | REVOKED (`PUBLIC, anon`), GRANTED (`authenticated`) | GRANTED | `postgres` / `public, auth, pg_temp` | `L1294-L1298` |
