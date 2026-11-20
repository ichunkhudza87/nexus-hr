# NEXUS HR — PHASE 3.12D.1 EFFECTIVE PRIVILEGE MATRIX

**Scope:** Effective privileges resulting from `002_branch_a_schema.sql` + `001_branch_a_security_remediation_v2_7.sql` (Static Catalog Analysis — live PG17 `\dp` **NOT VERIFIED** locally).

---

## 1. Table-Level Effective Privileges (Branch A)

| Object | `PUBLIC` | `anon` | `authenticated` | `service_role` | `postgres` | Audit Status |
|---|---|---|---|---|---|---|
| `public.leave_requests` | NONE | NONE | `SELECT`, `INSERT` (`UPDATE`, `DELETE`, `TRUNCATE` revoked + `RESTRICTIVE` deny `UPDATE` policy) | **`INSERT`, `SELECT`, `UPDATE` (blocked by trigger), `DELETE` (ALLOWED!), `TRUNCATE` (ALLOWED!)** | ALL | **FAIL (`D1-01` CRITICAL)** |
| `public.audit_logs` | NONE | NONE | `SELECT` (`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` revoked) | **`INSERT`, `SELECT`, `UPDATE`, `DELETE`, `TRUNCATE` (ALL ALLOWED!)** | ALL | **FAIL (`D1-01` CRITICAL)** |
| `public.employees` | NONE | NONE | `SELECT` (`DELETE`, `TRUNCATE` revoked) | `ALL` (needed for Sync Worker? Check `DELETE` block trigger `prevent_hard_delete_employees`) | ALL | WARN |
| `public.sync_outbox` | NONE | NONE | NONE | `ALL` (Sync Worker) | ALL | PASS |
| `nexus_internal.gateway_signing_keys` | NONE | NONE | NONE | NONE | ALL | **PASS** |
| `nexus_internal.used_actor_nonces` | NONE | NONE | NONE | NONE | ALL | **PASS** |
| `nexus_internal.tx_actor_context` | NONE | NONE | NONE | NONE | ALL | **PASS** |

---

## 2. Function-Level Effective `EXECUTE` Privileges (Branch A)

| Function | `PUBLIC` | `anon` | `authenticated` | `service_role` | `postgres` |
|---|---|---|---|---|---|
| `nexus_internal.verify_gateway_actor(...)` (12 args) | REVOKED | REVOKED | REVOKED | REVOKED | OWNER |
| `nexus_internal.cleanup_expired_actor_nonces(INTEGER)` | REVOKED | REVOKED | REVOKED | REVOKED | OWNER |
| `public.rpc_branch_decide_leave_request(...)` (12 args) | REVOKED | REVOKED | REVOKED | **GRANTED** | OWNER |
| `public.rpc_superadmin_update_leave_request(...)` (24 args) | REVOKED | REVOKED | REVOKED | **GRANTED** | OWNER |
| `public.get_auth_role()` | REVOKED | REVOKED | GRANTED | GRANTED | OWNER |
| `public.get_current_employee_id()` | REVOKED | REVOKED | GRANTED | GRANTED | OWNER |
| `public.claim_outbox_batch(...)` / `mark_outbox_*` | REVOKED | REVOKED | REVOKED | GRANTED | OWNER |
| Trigger functions (`record_branch_audit_log`, `enforce_leave_decision_integrity`, etc.) | REVOKED | REVOKED | REVOKED | Inherited via `002` L1103 (`GRANT ALL ON ALL FUNCTIONS`) | OWNER |

---

## 3. Required Privilege Remediation Before Execution (`D1-01`)

To enforce true **RPC-only leave mutation** and **append-only audit logs** even against compromised `service_role` / Sync Worker credentials:
```sql
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.leave_requests FROM service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.audit_logs FROM service_role;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM service_role;
```
*(Plus add a `BEFORE DELETE` trigger on `public.leave_requests` raising `42501`, and include `DELETE` in `trg_audit_leave_requests`.)*
