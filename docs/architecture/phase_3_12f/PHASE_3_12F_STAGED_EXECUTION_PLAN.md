# Phase 3.12F — Staged Migration Execution Plan

**Date:** 2026-11-12  
**Project:** NEXUS HR (`D:\Antigravity_Projects\nexus-hr`)  
**Status:** **PLAN ONLY — NOT AUTHORIZED FOR EXECUTION**

---

## 1. Authoritative Targets & Verified SQL Artifacts

| Stage | Target Database | Ref & URL | SQL File | Verified SHA-256 |
| :--- | :--- | :--- | :--- | :--- |
| **Stage 1** | `nexus-branch-a` | `uneycmbqqpkifwhwzbes` (`https://uneycmbqqpkifwhwzbes.supabase.co`) | `supabase/remediation/v2.7.2/000_branch_a_config_compatibility_v2_7_2.sql` | `B7D9FA212BCC09561E61E8C9B17212CCF29F16DFCDBD272AB25336BDBD702F07` |
| **Stage 2** | `nexus-branch-a` | `uneycmbqqpkifwhwzbes` (`https://uneycmbqqpkifwhwzbes.supabase.co`) | `supabase/remediation/v2.7.1/001_branch_a_security_remediation_v2_7_1.sql` | `10394258BA64D8F1B1DA5847C5D3349209291FF384063F7EB03D2E2DCBFDE756` |
| **Stage 3** | `nexus-central` | `wcmevigbqsmzsdqidjel` (`https://wcmevigbqsmzsdqidjel.supabase.co`) | `supabase/remediation/v2.7.1/002_central_seed_and_rollback_v2_7_1.sql` *(Lines 1–63 Seed Only)* | `C4A9742D7030D4BDD93C7E0487F03EE9827DC27EABF691A976F6C559ED69DE54` |

Baseline files (preserved unmodified):
- `supabase/migrations/001_central_schema.sql`: `02447A8F2923ED49235DDD77D5EED33D47B0E023F0108A6495BDD7CC1C9C0260`
- `supabase/migrations/002_branch_a_schema.sql`: `F1C8960FA8504E6AC9DD134FAC9BE68768DBDAF33FAED4A5B3F402D541874EC1`

---

## 2. Stage-by-Stage Execution Sequence

### STAGE 0 — Final Pre-Execution Checks
Execute all checks in `PHASE_3_12F_PRE_EXECUTION_CHECKLIST.md` and `STAGE 0` queries in `PHASE_3_12F_STAGE_VERIFICATION_QUERIES.sql`. Confirm backups/snapshots are taken before any mutation.

### STAGE 1 — Branch A Compatibility (`uneycmbqqpkifwhwzbes`)
- **File:** `000_branch_a_config_compatibility_v2_7_2.sql`
- **Why First:** `001_branch_a_security_remediation_v2_7_1.sql` (`L59`, `L433`, `L437`) selects and checks `public.branch_config.is_active`, which is absent in `002_branch_a_schema.sql`.
- **Expected Result:** `public.branch_config` retains its exact 1 singleton row (`00000000-0000-0000-0000-000000000001`, `'BRANCH-A'`) and all 6 baseline columns unchanged, with `is_active BOOLEAN NOT NULL DEFAULT TRUE` added (`TRUE` on singleton).
- **Verification:** Run `STAGE 1` read-only queries in `PHASE_3_12F_STAGE_VERIFICATION_QUERIES.sql`.
- **Stop Conditions:** Any exception (`42703`, row count != 1, altered baseline column, or post-check catalog mismatch) -> abort and do **not** proceed to Stage 2.

### STAGE 2 — Branch A Security Remediation (`uneycmbqqpkifwhwzbes`)
- **File:** `001_branch_a_security_remediation_v2_7_1.sql`
- **Dependency:** Requires Stage 1 (`branch_config.is_active`) completed and verified.
- **Expected Result:**
  - Private schema `nexus_internal` created (`gateway_signing_keys`, `used_actor_nonces`, `tx_actor_context` with `key_id VARCHAR(64) NOT NULL`), all `REVOKE ALL` from `PUBLIC, anon, authenticated, service_role`.
  - Functions: `cleanup_expired_actor_nonces(INTEGER)`, `verify_gateway_actor(...)` (12 args), `rpc_branch_decide_leave_request(...)` (12 args), `rpc_superadmin_update_leave_request(...)` (24 args), `prevent_hard_delete_leave_requests()`, `prevent_truncate_protected_tables()`, hardened `enforce_leave_decision_integrity()`, `record_branch_audit_log()`, `emit_employee_outbox_event()`, `generate_employee_code()`, `get_auth_role()`, `get_current_employee_id()`. All `SECURITY DEFINER` owned by `postgres` with explicit `pg_temp` `search_path`.
  - Triggers: `trg_01_enforce_leave_decision`, `trg_02_leave_requests_updated_at`, `trg_03_prevent_overlapping_leave`, `trg_04_prevent_delete_leave_requests`, `trg_05_prevent_truncate_leave_requests`, `trg_audit_leave_requests` (`AFTER INSERT OR UPDATE OR DELETE`), `trg_01_prevent_truncate_audit_logs`, and `trg_01_employees_generate_code`..`trg_03_employees_outbox_sync`.
  - Privileges & RLS: `leave_manager_decide` dropped, `leave_deny_direct_update` (`RESTRICTIVE FOR UPDATE`) active; `service_role` holds `SELECT` only on `leave_requests` and `audit_logs`, `TRUNCATE` revoked across `public`; RPCs executable only by `service_role` (+ `postgres`).
  - Sequence: `seq_branch_a_employee_code` `MAXVALUE 999999999999 NO CYCLE`.
- **Verification:** Run `STAGE 2` read-only queries in `PHASE_3_12F_STAGE_VERIFICATION_QUERIES.sql`.
- **Stop Conditions:** Any SQL error, missing `nexus_internal` table, `service_role` retaining DML on `leave_requests`/`audit_logs`, or missing RPC `EXECUTE` grant -> halt and execute Stage 2 rollback.

### STAGE 3 — Central Seed (`wcmevigbqsmzsdqidjel`)
- **File:** `002_central_seed_and_rollback_v2_7_1.sql` — **Execute Lines 1–63 ONLY** (the `BEGIN; ... COMMIT;` seed block). **Lines 65–115 are commented-out rollback reference SQL and MUST NOT be uncommented or executed during the seed stage.**
- **Expected Result:** Exactly 1 row in `public.branches`: `id = 00000000-0000-0000-0000-000000000001`, `code = 'BRANCH-A'`, `name = 'Branch A - Jakarta'`, `timezone = 'Asia/Jakarta'`, `is_active = TRUE`.
- **Conflict Handling:** Aborts if UUID belongs to another code or `'BRANCH-A'` belongs to another UUID; `ON CONFLICT (id) DO NOTHING` ensures idempotency.
- **Verification:** Run `STAGE 3` read-only queries in `PHASE_3_12F_STAGE_VERIFICATION_QUERIES.sql`.
- **Stop Conditions:** Seed conflict exception or post-seed assertion failure -> halt.

### STAGE 4 — Cross-Database & Contract Verification (Read-Only)
- Verify Central `public.branches` (`00000000-0000-0000-0000-000000000001`, `BRANCH-A`, `Asia/Jakarta`, `is_active = TRUE`) matches Branch A `public.branch_config`.
- Verify Gateway contract parity (12-field HMAC v2.7, `p_key_id`, tri-state `p_set_*`, SQLSTATE mapping, no direct browser access to Branch A, no cross-DB FKs).
- Note: Controlled functional RPC tests require separate out-of-band synthetic test key / Gateway test authorization (never production secrets in migrations).

---

## 3. PostgreSQL 17 Runtime Validation Evidence Required During Execution

Because local PostgreSQL 17 was unavailable in Phases 3.12D–3.12E.2, **actual PostgreSQL 17.11 runtime validation** must be captured during controlled execution by recording:
1. Full `psql`/MCP execution transcript (`NOTICE` messages and `COMMIT` confirmations) for Stages 1, 2, and 3.
2. Output of all `STAGE 1`–`STAGE 4` read-only verification queries from `PHASE_3_12F_STAGE_VERIFICATION_QUERIES.sql`.
3. `EXPLAIN` / catalog confirmation of `tx_actor_context.key_id` (`character varying(64)`, `NOT NULL`), `branch_config.is_active` (`boolean`, `NOT NULL`, `DEFAULT true`), and `has_table_privilege('service_role', ...)` returning `false` for `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` on `leave_requests` and `audit_logs`.
