# NEXUS HR — PHASE 3.12D.1 SQL SECURITY AUDIT

**Role:** Senior PostgreSQL 17 Database Architect & Database Security Auditor  
**Workspace:** `D:\Antigravity_Projects\nexus-hr`  
**Mode:** STRICT READ-ONLY PRE-EXECUTION AUDIT  
**Inspected Sources:**
- `supabase/remediation/v2.7/001_branch_a_security_remediation_v2_7.sql` (1140 lines)
- `supabase/remediation/v2.7/002_central_seed_and_rollback_v2_7.sql` (115 lines)
- `supabase/migrations/001_central_schema.sql` (699 lines)
- `supabase/migrations/002_branch_a_schema.sql` (1112 lines)
- `gateway/src/security/hmac-signer.ts`, `gateway/src/clients/branch-rpc-client.ts`

---

## Executive Summary

A line-by-line, read-only security audit of **SQL Remediation v2.7** identified **one CRITICAL blocking security defect (`D1-01`)** regarding `service_role` direct mutation privileges, **two HIGH/MEDIUM schema/behavioral findings (`D1-02`, `D1-03`)**, and **two verification blockers (`D1-08`: PG17 local parsing unavailable + remote Branch A project ref discrepancy)**.

While v2.7 successfully closes `authenticated` direct `UPDATE` bypasses, enforces `p_key_id` + 12-field canonical HMAC binding, preserves omitted `SUPERADMIN` `CORRECTION` fields, and adds `FOR UPDATE SKIP LOCKED` bounded nonce cleanup, **`service_role` still holds baseline `GRANT ALL` privileges (`002_branch_a_schema.sql` L1101)** across `public.leave_requests` and `public.audit_logs` without `DELETE`/`TRUNCATE` revocations or `BEFORE DELETE` / `AFTER DELETE` trigger defenses.

---

## Audit Area A — `service_role` Direct Mutation Analysis (MANDATORY HIGH-PRIORITY)

| Table | `service_role` Baseline Grant (`002_branch_a_schema.sql` L1101) | v2.7 Revocations (`001_..._v2_7.sql` L999-1002) | Trigger Protection | Effective `service_role` Capability |
|---|---|---|---|---|
| `public.leave_requests` | `ALL` (`INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER`) | Revoked ONLY from `PUBLIC, anon, authenticated` (`L1001`) | `trg_01_enforce_leave_decision` (`BEFORE UPDATE` only, `L726-728`); `trg_audit_leave_requests` (`AFTER INSERT OR UPDATE` only, `002` L570-572) | **`INSERT` ALLOWED (no actor-context trigger); `UPDATE` BLOCKED by trigger; `DELETE` ALLOWED (NO trigger, NO audit!); `TRUNCATE` ALLOWED (NO trigger, NO audit!)** |
| `public.audit_logs` | `ALL` | Revoked ONLY from `PUBLIC, anon, authenticated` (`L1002`) | None | **`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` ALL ALLOWED directly by `service_role`!** |
| `nexus_internal.gateway_signing_keys` | None | `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` (`L100`) | N/A | **BLOCKED** (No `USAGE` on `nexus_internal`, no table grants) |
| `nexus_internal.used_actor_nonces` | None | `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` (`L112`) | N/A | **BLOCKED** |
| `nexus_internal.tx_actor_context` | None | `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` (`L134`) | N/A | **BLOCKED** |

### Blocking Finding `D1-01` [CRITICAL]
- **Evidence:** `service_role` has `BYPASSRLS` in Supabase and retains `INSERT`, `DELETE`, and `TRUNCATE` on `public.leave_requests`, plus `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE` on `public.audit_logs`.
- **Exploit / Failure Scenario:** Any Sync Worker compromise or direct PostgREST `service_role` request (`DELETE /rest/v1/leave_requests?...` or `DELETE /rest/v1/audit_logs`) bypasses `verify_gateway_actor()`, `tx_actor_context`, `enforce_leave_decision_integrity()`, and `record_branch_audit_log()`, silently deleting leave requests or erasing audit trails. Similarly, `service_role` can `INSERT` a pre-`APPROVED` leave request directly into `leave_requests` bypassing `PENDING` workflow.
- **Required Fix:** Revoke `INSERT, UPDATE, DELETE, TRUNCATE` on `public.leave_requests` and `public.audit_logs` from `service_role` (since RPCs and audit triggers are `SECURITY DEFINER` owned by `postgres`), revoke `TRUNCATE` on all `public` tables from `service_role`, and add a `BEFORE DELETE` guard trigger + `AFTER DELETE` audit trigger on `public.leave_requests`.

---

## Audit Area B — RLS & Grant Combination

- **Permissive Policies on `leave_requests`:** `leave_select` (`FOR SELECT TO authenticated`) and `leave_self_submit` (`FOR INSERT TO authenticated`) from `002_branch_a_schema.sql` L1054-1067. Legacy `leave_manager_decide` (`FOR UPDATE`) is dropped (`L986`).
- **Restrictive Policy Added (`L990-996`):** `leave_deny_direct_update` (`AS RESTRICTIVE FOR UPDATE TO authenticated USING (FALSE) WITH CHECK (FALSE)`).
- **Combination Analysis:**
  - `SELECT` & `INSERT` for `authenticated` remain intact because the restrictive policy is scoped to `FOR UPDATE` only.
  - Any future permissive `FOR UPDATE` or `FOR ALL` policy for `authenticated` will be intersected (`AND FALSE`) by `leave_deny_direct_update`.
  - Primary protection for `authenticated`, `anon`, and `PUBLIC` is `REVOKE UPDATE, DELETE ON TABLE public.leave_requests FROM PUBLIC, anon, authenticated;` (`L1001`).
  - **Gap:** `service_role` bypasses RLS and was omitted from `REVOKE` (`D1-01`).

---

## Audit Area C — `SECURITY DEFINER` Functions Audit

| Function | Owner | `search_path` | `PUBLIC`/`anon`/`auth` `EXECUTE` | `service_role` `EXECUTE` | Dynamic SQL | Assessment |
|---|---|---|---|---|---|---|
| `nexus_internal.cleanup_expired_actor_nonces(INTEGER)` | `postgres` (`L188`) | `nexus_internal, pg_temp` (`L148`) | Revoked (`L189-190`) | Revoked (`L189-190`) | None | **PASS** |
| `nexus_internal.verify_gateway_actor(...)` (12 args) | `postgres` (`L444`) | `nexus_internal, public, extensions, pg_temp` (`L217`) | Revoked (`L446-448`) | Revoked (`L446-448`) | None | **PASS** (note `D1-06` GUC check on PG17) |
| `public.record_branch_audit_log()` | `postgres` (`L589`) | `nexus_internal, public, auth, pg_temp` (`L516`) | Revoked (`L1122`) | Default? (`ALL FUNCTIONS` in `002` L1103) | None | **PASS** (trigger fn; revoke from `service_role` for cleanliness) |
| `public.enforce_leave_decision_integrity()` | `postgres` (`L718`) | `nexus_internal, public, pg_temp` (`L598`) | Revoked (`L1132`) | Default (`002` L1103) | None | **PASS** (trigger fn) |
| `public.rpc_branch_decide_leave_request(...)` (12 args) | `postgres` (`L814`) | `nexus_internal, public, pg_temp` (`L767`) | Revoked (`L816-818`) | Granted (`L820-822`) | None | **PASS** |
| `public.rpc_superadmin_update_leave_request(...)` (24 args) | `postgres` (`L967`) | `nexus_internal, public, pg_temp` (`L854`) | Revoked (`L969-972`) | Granted (`L974-977`) | None | **PASS** (see `D1-03` for `CORRECTION` transition note) |
| `public.emit_employee_outbox_event()` | `postgres` (`L1088`) | `public, pg_temp` (`L1037`) | Revoked (`L1123`) | Default (`002` L1103) | None | **PASS** |

- All `SECURITY DEFINER` functions set explicit `SET search_path` including `pg_temp` last, use schema-qualified table/function references, contain zero dynamic SQL (`EXECUTE`), and are owned by `postgres`.
- `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA nexus_internal` (`L64-69`) revokes table, function, and sequence privileges from `PUBLIC, anon, authenticated, service_role`.

---

## Audit Area G — `SUPERADMIN` Partial `CORRECTION` Audit (24 Parameters)

- **Omitted vs Explicit `NULL`:** `p_set_rejection_reason`, `p_set_approved_by`, and `p_set_approved_at` (`BOOLEAN DEFAULT FALSE`, `L839-841`) preserve `v_existing.*` when `FALSE` (`L916-927`).
- **Pre-Update Validation (`L897-939`):** Blank `p_reason` rejected (`23514`); `end_date < start_date` rejected (`23514`); `total_days <= 0` rejected (`23514`); resulting `status = 'REJECTED'` with `NULL` `v_next_rejection_reason` rejected (`23514`).
- **Trigger & Audit Rollback:** `trg_01_enforce_leave_decision` re-validates immutable fields, dates, `total_days`, `reason`, `REJECTED` reason, and valid non-deleted `employee_id` (`L614-658`). Any failure rolls back both `leave_requests` and `audit_logs`.
- **Minor Observation (`D1-03`):** If `SUPERADMIN` in `CORRECTION` mode transitions a `PENDING` row (`approved_by IS NULL`) to `APPROVED` while leaving `p_set_approved_by = FALSE`, `approved_by` and `approved_at` stay `NULL` unless explicitly supplied. Document or enforce approval metadata rule in v2.7.1/v2.8.

---

## Audit Area I — Central Seed & Rollback (`002_central_seed_and_rollback_v2_7.sql`)

- **Conflict Guards (`L10-31`):** Aborts if UUID `00000000-0000-0000-0000-000000000001` belongs to a different branch code OR if `'BRANCH-A'` belongs to a different UUID.
- **Idempotency (`L33-44`):** `INSERT ... ON CONFLICT (id) DO NOTHING` preserves any customized fields (e.g., `address`, `phone_number`) on existing rows, followed by post-seed assertion (`L46-61`).
- **Race-Safe Rollback (`L70-115`):** Acquires `SELECT ... FOR UPDATE` on `public.branches` (`L82-85`) to serialize against concurrent child `FOR KEY SHARE` FK inserts across all four child tables (`employee_directory`, `attendance_daily_summaries`, `user_profiles`, `audit_logs`). Soft-deactivates (`is_active = FALSE`) whenever any child reference exists, preventing `ON DELETE SET NULL` history loss.
