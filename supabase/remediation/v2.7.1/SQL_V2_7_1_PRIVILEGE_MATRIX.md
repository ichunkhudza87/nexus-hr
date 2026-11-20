# SQL Remediation v2.7.1 — Effective Privilege Matrix & Verification Queries

**Date:** 2026-11-12  
**Status:** Static Analysis (Live PG17 `\dp` execution **NOT VERIFIED** locally)

---

## 1. Table-Level Effective Privileges (Branch A After v2.7.1)

| Object | `PUBLIC` | `anon` | `authenticated` | `service_role` | `postgres` (Owner) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `public.leave_requests` | NONE | NONE | `SELECT`, `INSERT` (`leave_self_submit` RLS; `UPDATE`/`DELETE`/`TRUNCATE` revoked + `RESTRICTIVE` deny `UPDATE` policy + `BEFORE DELETE`/`TRUNCATE` triggers) | **`SELECT` ONLY** (`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` revoked + triggers) | ALL |
| `public.audit_logs` | NONE | NONE | `SELECT` ONLY (`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` revoked) | **`SELECT` ONLY** (`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` revoked + `BEFORE TRUNCATE` trigger) | ALL |
| `public.employees` | NONE | NONE | `SELECT` (`TRUNCATE` revoked) | `SELECT, INSERT, UPDATE, DELETE` (`TRUNCATE` revoked; `prevent_hard_delete_employees` trigger) | ALL |
| `public.sync_outbox` | NONE | NONE | NONE | `SELECT, INSERT, UPDATE, DELETE` (`TRUNCATE` revoked) | ALL |
| `nexus_internal.gateway_signing_keys` | NONE | NONE | NONE | NONE | ALL |
| `nexus_internal.used_actor_nonces` | NONE | NONE | NONE | NONE | ALL |
| `nexus_internal.tx_actor_context` | NONE | NONE | NONE | NONE | ALL |

---

## 2. Function-Level Effective `EXECUTE` Privileges

| Function | `PUBLIC` | `anon` | `authenticated` | `service_role` | `postgres` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `nexus_internal.verify_gateway_actor(...)` (12 args) | REVOKED | REVOKED | REVOKED | REVOKED | OWNER |
| `nexus_internal.cleanup_expired_actor_nonces(INTEGER)` | REVOKED | REVOKED | REVOKED | REVOKED | OWNER |
| `public.rpc_branch_decide_leave_request(...)` (12 args) | REVOKED | REVOKED | REVOKED | **GRANTED** | OWNER |
| `public.rpc_superadmin_update_leave_request(...)` (24 args) | REVOKED | REVOKED | REVOKED | **GRANTED** | OWNER |
| `public.get_auth_role()` / `public.get_current_employee_id()` | REVOKED | REVOKED | GRANTED | GRANTED | OWNER |
| Trigger functions (`record_branch_audit_log`, `enforce_leave_decision_integrity`, `prevent_hard_delete_leave_requests`, `prevent_truncate_protected_tables`, etc.) | REVOKED | REVOKED | REVOKED | **REVOKED** | OWNER |

---

## 3. Effective Privilege Verification SQL Queries (For PG17 / Preflight)

```sql
-- 1. Verify table privileges for service_role, authenticated, anon, PUBLIC
SELECT grantee, table_schema, table_name,
       string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema IN ('public', 'nexus_internal')
  AND table_name IN ('leave_requests', 'audit_logs', 'gateway_signing_keys', 'used_actor_nonces', 'tx_actor_context')
  AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role', 'postgres')
GROUP BY grantee, table_schema, table_name
ORDER BY table_schema, table_name, grantee;

-- 2. Verify explicit has_table_privilege checks for service_role & authenticated
SELECT r.rolname,
       has_table_privilege(r.rolname, 'public.leave_requests', 'INSERT') AS lr_ins,
       has_table_privilege(r.rolname, 'public.leave_requests', 'UPDATE') AS lr_upd,
       has_table_privilege(r.rolname, 'public.leave_requests', 'DELETE') AS lr_del,
       has_table_privilege(r.rolname, 'public.leave_requests', 'TRUNCATE') AS lr_trunc,
       has_table_privilege(r.rolname, 'public.audit_logs', 'INSERT') AS al_ins,
       has_table_privilege(r.rolname, 'public.audit_logs', 'UPDATE') AS al_upd,
       has_table_privilege(r.rolname, 'public.audit_logs', 'DELETE') AS al_del,
       has_table_privilege(r.rolname, 'public.audit_logs', 'TRUNCATE') AS al_trunc
FROM pg_roles r
WHERE r.rolname IN ('anon', 'authenticated', 'service_role');

-- 3. Verify function EXECUTE privileges
SELECT p.pronamespace::regnamespace AS schema_name,
       p.proname,
       has_function_privilege('PUBLIC', p.oid, 'EXECUTE') AS pub_exec,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_exec
FROM pg_proc p
WHERE p.pronamespace::regnamespace::text IN ('public', 'nexus_internal')
  AND p.proname IN (
      'verify_gateway_actor',
      'cleanup_expired_actor_nonces',
      'rpc_branch_decide_leave_request',
      'rpc_superadmin_update_leave_request',
      'enforce_leave_decision_integrity',
      'record_branch_audit_log',
      'prevent_hard_delete_leave_requests',
      'prevent_truncate_protected_tables'
  )
ORDER BY schema_name, p.proname;

-- 4. Verify role memberships and BYPASSRLS attribute
SELECT r.rolname, r.rolsuper, r.rolbypassrls,
       ARRAY(SELECT m.rolname FROM pg_auth_members am JOIN pg_roles m ON m.oid = am.roleid WHERE am.member = r.oid) AS member_of
FROM pg_roles r
WHERE r.rolname IN ('anon', 'authenticated', 'service_role', 'authenticator', 'postgres');
```
