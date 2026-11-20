# Phase 3.12F — Rollback and Recovery Plan

**Date:** 2026-11-12  
**Status:** **PLAN ONLY — DO NOT EXECUTE WITHOUT AUTHORIZATION**

---

## 1. Recovery Prerequisites

- Verify Supabase PITR / pre-execution snapshot for both `wcmevigbqsmzsdqidjel` (`nexus-central`) and `uneycmbqqpkifwhwzbes` (`nexus-branch-a`) before Stage 1.

## 2. Reverse-Order Rollback Procedures

### Stage 3 Rollback (`nexus-central` — `wcmevigbqsmzsdqidjel`)
- Use the `FOR UPDATE` 4-table-checked rollback procedure in `002_central_seed_and_rollback_v2_7_1.sql` (lines 71–114):
  - Locks `public.branches` row `FOR UPDATE`.
  - Checks `employee_directory`, `attendance_daily_summaries`, `user_profiles`, `audit_logs`.
  - Soft-deactivates (`is_active = FALSE`) if any child reference exists; deletes only if zero references exist.

### Stage 2 Rollback (`nexus-branch-a` — `uneycmbqqpkifwhwzbes`)
- Follow `supabase/remediation/v2.7.1/SQL_V2_7_1_ROLLBACK_PLAN.md`:
  - Drop v2.7.1 defense triggers & RPCs (`rpc_branch_decide_leave_request`, `rpc_superadmin_update_leave_request`, `verify_gateway_actor`, `cleanup_expired_actor_nonces`).
  - Keep `leave_requests` and `audit_logs` direct DML revocations in place by default (fail-closed) unless emergency maintenance is explicitly declared.

### Stage 1 Rollback (`nexus-branch-a` — `uneycmbqqpkifwhwzbes`)
- Per `E2-02` decision (`PHASE_3_12F_LOW_FINDINGS_DECISION.md`):
  - **Recommended:** Preserve `public.branch_config.is_active` (`BOOLEAN NOT NULL DEFAULT TRUE`) during partial rollbacks so operational active/inactive state is never discarded.
  - **Only if full baseline schema revert is required** (after Stage 2 is already rolled back): `ALTER TABLE public.branch_config DROP COLUMN IF EXISTS is_active;`.
