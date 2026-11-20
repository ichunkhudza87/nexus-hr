# NEXUS HR — SQL REMEDIATION V2.7 ROLLBACK PLAN

**Target Nodes:** `nexus-central` (`wcmevigbqsmzsdqidjel`) & `nexus-branch-a` (`uneycmbqqpkifwhwzbes`)  
**Status:** DRAFT / SPECIFICATION ONLY — DO NOT EXECUTE IN PHASE 3.12C

---

## 1. Pre-Rollback Controls
1. Pause Gateway & Sync Worker writes (maintenance mode) before reverting either database.
2. Snapshot current table row counts (`branches`, `user_profiles`, `employees`, `leave_requests`, `audit_logs`, `sync_outbox`) and `nexus_internal.gateway_signing_keys` metadata (without exporting secrets into plain logs).

## 2. Central Database Rollback (`002_central_seed_and_rollback_v2_7.sql`)
- Uses `SELECT id INTO v_locked_id FROM public.branches WHERE id = '00000000-0000-0000-0000-000000000001'::uuid FOR UPDATE;` to serialize against concurrent FK inserts (`FOR KEY SHARE`) across all 4 referencing child tables (`employee_directory`, `attendance_daily_summaries`, `user_profiles`, `audit_logs`).
- Soft-deactivates (`is_active = FALSE`) if any child row references `BRANCH-A`, preserving FK history; only executes `DELETE` when zero references exist across all 4 tables under the `FOR UPDATE` row lock.

## 3. Branch A Database Rollback (`001_branch_a_security_remediation_v2_7.sql`)

```sql
BEGIN;

-- 1. Drop v2.7 Gateway RPCs
DROP FUNCTION IF EXISTS public.rpc_branch_decide_leave_request(
    TEXT, UUID, VARCHAR, TEXT, UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
);
DROP FUNCTION IF EXISTS public.rpc_superadmin_update_leave_request(
    TEXT, UUID, TEXT, UUID, VARCHAR, DATE, DATE, NUMERIC, TEXT, VARCHAR, TEXT, UUID, TIMESTAMPTZ,
    BOOLEAN, BOOLEAN, BOOLEAN, UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
);

-- 2. Drop v2.7 leave triggers and integrity guard; restore baseline leave_requests triggers
DROP TRIGGER IF EXISTS trg_01_enforce_leave_decision ON public.leave_requests;
DROP TRIGGER IF EXISTS trg_02_leave_requests_updated_at ON public.leave_requests;
DROP TRIGGER IF EXISTS trg_03_prevent_overlapping_leave ON public.leave_requests;
DROP FUNCTION IF EXISTS public.enforce_leave_decision_integrity();

CREATE TRIGGER trg_leave_requests_updated_at
    BEFORE UPDATE ON public.leave_requests
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_prevent_overlapping_leave
    BEFORE INSERT OR UPDATE ON public.leave_requests
    FOR EACH ROW EXECUTE FUNCTION public.prevent_overlapping_leave();

-- 3. Restore baseline employees triggers
DROP TRIGGER IF EXISTS trg_01_employees_generate_code ON public.employees;
DROP TRIGGER IF EXISTS trg_02_employees_updated_at ON public.employees;
DROP TRIGGER IF EXISTS trg_03_employees_outbox_sync ON public.employees;

CREATE TRIGGER trg_employees_updated_at
    BEFORE UPDATE ON public.employees
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_generate_employee_code
    BEFORE INSERT ON public.employees
    FOR EACH ROW EXECUTE FUNCTION public.generate_employee_code();

CREATE TRIGGER trg_employee_outbox_sync
    BEFORE INSERT OR UPDATE ON public.employees
    FOR EACH ROW EXECUTE FUNCTION public.emit_employee_outbox_event();

-- 4. Remove v2.7 RESTRICTIVE deny-update policy & restore baseline leave_requests grants ONLY if emergency
--    legacy direct-client fallback is explicitly authorized (otherwise keep REVOKE UPDATE active!)
DROP POLICY IF EXISTS "leave_deny_direct_update" ON public.leave_requests;

-- 5. Archive internal schema by default; drop internal verifier only if full teardown requested
REVOKE ALL ON FUNCTION nexus_internal.verify_gateway_actor(
    TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
```

> **Security Warning:** Restoring `GRANT UPDATE ON public.leave_requests TO authenticated` or `leave_manager_decide` re-opens the pre-remediation self-approval and field-tampering exposure; keep `leave_requests` `UPDATE` revoked until Gateway v2.7 is restored.
