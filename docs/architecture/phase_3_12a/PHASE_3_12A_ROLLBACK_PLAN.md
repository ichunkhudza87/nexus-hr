# NEXUS HR — PHASE 3.12A: SYMMETRIC & RACE-SAFE ROLLBACK PLAN

**Scope:** Reversing Remediation v2.6 changes cleanly on `nexus-central` (`wcmevigbqsmzsdqidjel`) and `nexus-branch-a` (`uneycmbqqpkifwhwzbes`) if needed after deployment.  
**Mode:** SPECIFICATION ONLY — DO NOT EXECUTE IN PHASE 3.12A.

---

## 1. PRE-ROLLBACK SAFETY CHECKLIST

1. Enable maintenance mode on Backend API Gateway (stop in-flight leave approval RPC calls and Sync Worker polling).
2. Capture a schema & row count snapshot on both nodes before running rollback SQL.
3. Verify no active `locked_by` leases remain in `sync_outbox` / `sync_inbox` (or allow in-flight leases to finish).

---

## 2. CENTRAL DATABASE ROLLBACK (`nexus-central` / `wcmevigbqsmzsdqidjel`)

### 2.1 Foreign Key & Concurrency Hazard Analysis
Catalog inspection of `nexus-central` confirms **four** foreign keys pointing to `public.branches(id)`:
- `employee_directory_branch_id_fkey`: `ON DELETE RESTRICT`
- `attendance_daily_summaries_branch_id_fkey`: `ON DELETE RESTRICT`
- `user_profiles_branch_id_fkey`: `ON DELETE SET NULL`
- `audit_logs_branch_id_fkey`: `ON DELETE SET NULL`

**Why Naive `DELETE` is Dangerous:**
1. Deleting a branch when `user_profiles` or `audit_logs` has rows referencing it silently overwrites `branch_id = NULL`, destroying historical branch attribution.
2. Checking `COUNT(*) = 0` without row locking is vulnerable to a race condition under `READ COMMITTED`: another transaction could insert a `user_profiles` or `audit_logs` row between the check and `DELETE`.

### 2.2 Race-Safe Transactional Rollback SQL
PostgreSQL foreign key inserts acquire a `FOR KEY SHARE` row lock on the parent `branches` row. Acquiring `SELECT ... FOR UPDATE` on `public.branches` conflicts with `FOR KEY SHARE`, **serializing concurrent child-table inserts** until the rollback transaction commits or aborts.

```sql
-- ============================================================================
-- CENTRAL ROLLBACK: RACE-SAFE NON-DESTRUCTIVE BRANCH ROLLBACK
-- Target: nexus-central (wcmevigbqsmzsdqidjel)
-- ============================================================================
BEGIN;

DO $$
DECLARE
    v_branch_id CONSTANT UUID := '00000000-0000-0000-0000-000000000001'::uuid;
    v_locked_id UUID;
    v_has_emp_dir BOOLEAN;
    v_has_att_sum BOOLEAN;
    v_has_profiles BOOLEAN;
    v_has_audits BOOLEAN;
BEGIN
    -- Step 1: Acquire exclusive row lock on target branch row.
    -- Blocks any concurrent INSERT/UPDATE in child tables attempting FOR KEY SHARE,
    -- and waits for any uncommitted child transaction currently holding FOR KEY SHARE.
    SELECT id INTO v_locked_id
    FROM public.branches
    WHERE id = v_branch_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE NOTICE 'Branch % does not exist on Central; nothing to roll back.', v_branch_id;
        RETURN;
    END IF;

    -- Step 2: Inspect ALL FOUR referencing child tables while holding FOR UPDATE lock
    SELECT EXISTS (SELECT 1 FROM public.employee_directory WHERE branch_id = v_branch_id) INTO v_has_emp_dir;
    SELECT EXISTS (SELECT 1 FROM public.attendance_daily_summaries WHERE branch_id = v_branch_id) INTO v_has_att_sum;
    SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE branch_id = v_branch_id) INTO v_has_profiles;
    SELECT EXISTS (SELECT 1 FROM public.audit_logs WHERE branch_id = v_branch_id) INTO v_has_audits;

    IF v_has_emp_dir OR v_has_att_sum OR v_has_profiles OR v_has_audits THEN
        -- Preferred non-destructive path: Soft deactivate branch to preserve all FK history
        UPDATE public.branches
        SET is_active = FALSE,
            updated_at = now()
        WHERE id = v_branch_id;

        RAISE NOTICE 'References detected (emp_dir=%, att_sum=%, profiles=%, audits=%). Soft-deactivated BRANCH-A (is_active=FALSE).',
            v_has_emp_dir, v_has_att_sum, v_has_profiles, v_has_audits;
    ELSE
        -- Zero references across all 4 tables under FOR UPDATE lock; safe to either
        -- soft-deactivate OR delete cleanly. Soft-deactivation remains safest default;
        -- uncomment DELETE only if strict pre-seed clean slate is required:
        DELETE FROM public.branches
        WHERE id = v_branch_id
          AND code = 'BRANCH-A';

        RAISE NOTICE 'Verified zero references across all 4 child tables under lock; removed unreferenced seed row.';
    END IF;
END $$;

COMMIT;
```

---

## 3. BRANCH A DATABASE ROLLBACK (`nexus-branch-a` / `uneycmbqqpkifwhwzbes`)

### 3.1 Security Warning on Rolling Back Branch A
Rolling back Remediation v2.6 on Branch A re-exposes baseline vulnerabilities (self-approval gap, sequence truncation at $\ge 10,000$, `trg_employee_outbox_sync` ordering bug, and `PUBLIC` RPC grants) unless superseded by an updated patch. **Gateway and Sync Worker traffic must remain paused until a corrected remediation is re-applied.**

### 3.2 Symmetric Branch A Rollback SQL
```sql
-- ============================================================================
-- BRANCH A ROLLBACK: RESTORE BASELINE OBJECTS & ARCHIVE INTERNAL SECURITY LOGS
-- Target: nexus-branch-a (uneycmbqqpkifwhwzbes)
-- ============================================================================
BEGIN;

-- 1. Drop v2.6 Gateway RPCs
DROP FUNCTION IF EXISTS public.rpc_branch_decide_leave_request(
    UUID, VARCHAR, TEXT, UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
);
DROP FUNCTION IF EXISTS public.rpc_superadmin_update_leave_request(
    UUID, TEXT, UUID, VARCHAR, DATE, DATE, NUMERIC, TEXT, VARCHAR, TEXT, UUID, TIMESTAMPTZ,
    UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
);

-- 2. Drop v2.6 leave integrity trigger & function, restore baseline leave_requests triggers
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

-- 3. Restore baseline employees triggers (preserving original definitions if required for strict parity)
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

-- 4. Restore baseline RLS policy on leave_requests & table grants
GRANT SELECT, INSERT, UPDATE ON TABLE public.leave_requests TO authenticated;
CREATE POLICY leave_manager_decide ON public.leave_requests
    FOR UPDATE TO authenticated
    USING (get_auth_role() = ANY (ARRAY['BRANCH_MANAGER'::text, 'SUPERADMIN'::text]))
    WITH CHECK ((status)::text = ANY ((ARRAY['APPROVED'::character varying, 'REJECTED'::character varying])::text[]));

-- 5. Preserve nexus_internal forensic/nonce history by default; do NOT drop blindly
-- If full removal of nexus_internal is strictly required after audit archival:
-- DROP FUNCTION IF EXISTS nexus_internal.verify_gateway_actor(TEXT, UUID, TEXT, UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT);
-- DROP SCHEMA IF EXISTS nexus_internal CASCADE;

COMMIT;
```

---

## 4. POST-ROLLBACK VERIFICATION QUERIES (READ-ONLY)

1. Verify Central `branches` state and child-table non-corruption:
   ```sql
   SELECT id, code, name, is_active FROM public.branches WHERE id = '00000000-0000-0000-0000-000000000001'::uuid;
   SELECT count(*) FILTER (WHERE branch_id IS NULL) AS null_profile_branches FROM public.user_profiles;
   ```
2. Verify Branch A trigger and RPC cleanup:
   ```sql
   SELECT proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND proname LIKE 'rpc_%';
   SELECT tgname FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid
   WHERE c.relname IN ('employees', 'leave_requests') AND NOT t.tgisinternal ORDER BY tgname;
   ```
