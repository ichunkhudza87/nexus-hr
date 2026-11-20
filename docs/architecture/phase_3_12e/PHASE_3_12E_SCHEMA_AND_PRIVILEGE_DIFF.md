# Phase 3.12E — Schema & Privilege Diff Report

**Date:** 2026-11-12  
**Compared Local Files (Verified SHA-256):**
- `001_central_schema.sql`: `02447A8F2923ED49235DDD77D5EED33D47B0E023F0108A6495BDD7CC1C9C0260`
- `002_branch_a_schema.sql`: `F1C8960FA8504E6AC9DD134FAC9BE68768DBDAF33FAED4A5B3F402D541874EC1`
- `001_branch_a_security_remediation_v2_7_1.sql`: `10394258BA64D8F1B1DA5847C5D3349209291FF384063F7EB03D2E2DCBFDE756`
- `002_central_seed_and_rollback_v2_7_1.sql`: `C4A9742D7030D4BDD93C7E0487F03EE9827DC27EABF691A976F6C559ED69DE54`

---

## 1. Detailed Findings

### `E-01` — `public.branch_config.is_active` Does Not Exist on `nexus-branch-a`
- **Finding ID:** `E-01`
- **Severity:** **CRITICAL (Migration Blocker)**
- **Target Project:** `nexus-branch-a` (`uneycmbqqpkifwhwzbes`)
- **Exact Database Object:** `public.branch_config` (vs `001_branch_a_security_remediation_v2_7_1.sql:L59, L433, L437`)
- **Evidence / Query Used:** `SELECT COALESCE(jsonb_agg(to_jsonb(bc)), '[]'::jsonb) FROM public.branch_config bc;`
- **Actual State:** `public.branch_config` has 7 columns: `id`, `branch_code`, `branch_name`, `operating_timezone`, `max_overtime_hours_per_day`, `attendance_grace_period_mins`, `updated_at`. No `is_active` column exists.
- **Expected State (by v2.7.1 SQL):** `SELECT id, branch_code, is_active INTO v_branch_cfg FROM public.branch_config` (`L59`, `L433`) and `v_branch_cfg.is_active IS NOT TRUE` (`L437`).
- **Impact:** Running `001_branch_a_security_remediation_v2_7_1.sql` will immediately abort at `L59` with `ERROR: 42703: column "is_active" does not exist`.
- **Recommended Next Action:** Produce **SQL v2.7.2** removing the `is_active` selection/check on `public.branch_config` (verifying `id` and `branch_code` only) — or explicitly adding `is_active` if desired by architecture (removing `is_active` avoids altering baseline table `branch_config` without necessity).

---

### `E-02` — `BRANCH-A` Not Yet Seeded on `nexus-central`
- **Finding ID:** `E-02`
- **Severity:** **HIGH (Cross-DB Consistency)**
- **Target Project:** `nexus-central` (`wcmevigbqsmzsdqidjel`)
- **Exact Database Object:** `public.branches`
- **Evidence / Query Used:** `SELECT ... FROM public.branches;`
- **Actual State:** `public.branches` has `0` rows.
- **Expected State:** Row `00000000-0000-0000-0000-000000000001`, `'BRANCH-A'`, `'Branch A - Jakarta'`, `'Asia/Jakarta'`, `is_active = TRUE`.
- **Impact:** Safe to seed (`0` conflicts), but Gateway `IdentityResolver` requires this row before Branch A operations.
- **Recommended Next Action:** Execute `002_central_seed_and_rollback_v2_7_1.sql` during the authorized staged execution phase.

---

### `E-03` — Baseline Over-Permissive Table & Function Grants on `nexus-branch-a`
- **Finding ID:** `E-03`
- **Severity:** **HIGH (Pre-Remediation Baseline State)**
- **Target Project:** `nexus-branch-a` (`uneycmbqqpkifwhwzbes`)
- **Exact Database Object:** `public.leave_requests`, `public.audit_logs`, 16 baseline functions
- **Evidence / Query Used:** `information_schema.role_table_grants`, `has_function_privilege()`
- **Actual State:** `anon`, `authenticated`, and `service_role` hold broad DML/TRUNCATE privileges on `leave_requests` and `service_role` holds `ALL` on `audit_logs`; all 16 functions grant `EXECUTE` to `public`/`anon`/`authenticated`/`service_role`.
- **Expected State:** Hardened by `001_branch_a_security_remediation_v2_7_1.sql` (once `E-01` is fixed in `v2.7.2`).
- **Impact:** Expected baseline state before remediation; must be closed before demo/production use.
- **Recommended Next Action:** Apply remediated SQL (`v2.7.2`) after `E-01` fix and staged execution approval.
