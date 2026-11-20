# Phase 3.12E — Remote Read-Only Preflight Summary

**Date:** 2026-11-12  
**Project:** NEXUS HR (`D:\Antigravity_Projects\nexus-hr`)  
**Mode:** STRICT READ-ONLY REMOTE PREFLIGHT

---

## 1. Authorized Targets Verified (Step A)

| Target | Project Name | Verified Ref | Host | PostgreSQL Version | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Central** | `nexus-central` | `wcmevigbqsmzsdqidjel` | `db.wcmevigbqsmzsdqidjel.supabase.co` | `17.11` (`17.11.0.018`) | `ACTIVE_HEALTHY` |
| **Branch A** | `nexus-branch-a` | `uneycmbqqpkifwhwzbes` | `db.uneycmbqqpkifwhwzbes.supabase.co` | `17.11` (`17.11.0.018`) | `ACTIVE_HEALTHY` |

---

## 2. Key Findings (Verified Database Facts vs Static SQL v2.7.1)

| Finding ID | Severity | Target | Object | Summary |
| :--- | :--- | :--- | :--- | :--- |
| **`E-01`** | **CRITICAL (Blocker)** | `nexus-branch-a` (`uneycmbqqpkifwhwzbes`) | `public.branch_config` vs `001_branch_a_security_remediation_v2_7_1.sql:L59, L433, L437` | **Actual:** `public.branch_config` has 7 columns (`id, branch_code, branch_name, operating_timezone, max_overtime_hours_per_day, attendance_grace_period_mins, updated_at`) and **NO `is_active` column**. **Expected by v2.7.1:** `SELECT id, branch_code, is_active FROM public.branch_config` (`L59`, `L433`) and `v_branch_cfg.is_active IS NOT TRUE` (`L437`). **Impact:** `001_branch_a_security_remediation_v2_7_1.sql` will immediately fail at `L59` with `ERROR: 42703: column "is_active" does not exist`. |
| **`E-02`** | **HIGH (Cross-DB State)** | `nexus-central` (`wcmevigbqsmzsdqidjel`) | `public.branches` | **Actual:** 0 rows in `public.branches`. **Expected:** `BRANCH-A` (`00000000-0000-0000-0000-000000000001`) seeded before Gateway auth/identity resolution. **Impact:** Gateway `IdentityResolver` will reject non-enterprise users until `002_central_seed_and_rollback_v2_7_1.sql` is executed. Zero conflicts exist for seeding. |
| **`E-03`** | **HIGH (Baseline Risk)** | `nexus-branch-a` (`uneycmbqqpkifwhwzbes`) | `public.leave_requests`, `public.audit_logs`, `public` functions | **Actual:** Baseline `002_branch_a_schema.sql` grants `ALL` on `leave_requests` and `audit_logs` to `service_role`, `ALL` on `leave_requests` to `anon`/`authenticated`, and `EXECUTE` on all 16 functions to `PUBLIC`/`anon`/`authenticated`/`service_role`, plus permissive `leave_manager_decide`. **Impact:** Expected pre-remediation state; confirms `v2.7.1` hardening (once `E-01` is fixed) is required. |

---

## 3. Final Decision

# **`NOT READY — MIGRATION BLOCKERS FOUND`**

*(This classification does **NOT** authorize migration execution. `E-01` must be remediated in SQL v2.7.2 before staged execution review.)*
