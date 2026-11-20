# SQL Remediation v2.7.1 — Rollback Plan

**Date:** 2026-11-12  
**Status:** Static Plan (PostgreSQL 17 execution **NOT VERIFIED** locally)

---

## 1. Branch A (`uneycmbqqpkifwhwzbes`) Rollback Strategy

If `001_branch_a_security_remediation_v2_7_1.sql` must be rolled back after deployment:

1. **Drop v2.7.1 Defense Triggers & Functions:**
   - Drop `trg_04_prevent_delete_leave_requests` and `trg_05_prevent_truncate_leave_requests` on `public.leave_requests`.
   - Drop `trg_01_prevent_truncate_audit_logs` on `public.audit_logs`.
   - Restore `trg_audit_leave_requests` to `AFTER INSERT OR UPDATE` if reverting to baseline.
   - Drop `public.rpc_branch_decide_leave_request` (12-arg) and `public.rpc_superadmin_update_leave_request` (24-arg).
   - Drop `nexus_internal.verify_gateway_actor` (12-arg) and `nexus_internal.cleanup_expired_actor_nonces(INTEGER)`.
2. **Preserve Fail-Closed `leave_requests` & `audit_logs` Protections by Default:**
   - Do **NOT** re-enable `leave_manager_decide` or grant direct `UPDATE`/`DELETE`/`TRUNCATE` back to `authenticated` or `service_role` unless an approved emergency maintenance window is declared.
3. **Internal Schema (`nexus_internal`):**
   - Retain `nexus_internal.gateway_signing_keys` and `used_actor_nonces` during rollback to avoid losing key revocation history or replay state unless full decommission is ordered.

---

## 2. Central (`wcmevigbqsmzsdqidjel`) Rollback Strategy

The rollback procedure in `002_central_seed_and_rollback_v2_7_1.sql` (lines 65–115):
1. Locks `public.branches` row `00000000-0000-0000-0000-000000000001` with `SELECT ... FOR UPDATE` to serialize against concurrent child `FOR KEY SHARE` FK inserts.
2. Checks all four child tables:
   - `public.employee_directory`
   - `public.attendance_daily_summaries`
   - `public.user_profiles`
   - `public.audit_logs`
3. **If any child reference exists:** Soft-deactivates (`is_active = FALSE, updated_at = now()`) instead of deleting, preventing `ON DELETE SET NULL` history loss.
4. **If zero child references exist:** Deletes the `BRANCH-A` seed row under the `FOR UPDATE` lock.
