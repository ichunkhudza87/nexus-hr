-- ============================================================================
-- NEXUS HR — PHASE 3.12D.2: CENTRAL BRANCH SEED V2.7.1
-- Target Database: nexus-central (Supabase Project Ref: wcmevigbqsmzsdqidjel)
-- Baseline: 001_central_schema.sql (preserved unmodified)
-- Supersedes Draft: supabase/remediation/v2.7/002_central_seed_and_rollback_v2_7.sql
-- Status: LOCAL DRAFT ONLY — NOT EXECUTED ON REMOTE SUPABASE
-- ============================================================================

BEGIN;

DO $$
DECLARE
    v_target_id CONSTANT UUID := '00000000-0000-0000-0000-000000000001'::uuid;
    v_conflict_code VARCHAR(20);
    v_conflict_id UUID;
BEGIN
    SELECT code INTO v_conflict_code
    FROM public.branches
    WHERE id = v_target_id;

    IF FOUND AND v_conflict_code IS DISTINCT FROM 'BRANCH-A' THEN
        RAISE EXCEPTION 'Seed conflict: UUID % already belongs to branch code %.', v_target_id, v_conflict_code;
    END IF;

    SELECT id INTO v_conflict_id
    FROM public.branches
    WHERE code = 'BRANCH-A';

    IF FOUND AND v_conflict_id IS DISTINCT FROM v_target_id THEN
        RAISE EXCEPTION 'Seed conflict: Code BRANCH-A already exists with UUID %.', v_conflict_id;
    END IF;
END $$;

INSERT INTO public.branches (
    id, code, name, timezone, address, phone_number, is_active
) VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    'BRANCH-A',
    'Branch A - Jakarta',
    'Asia/Jakarta',
    NULL,
    NULL,
    TRUE
)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
    v_row public.branches%ROWTYPE;
BEGIN
    SELECT * INTO v_row
    FROM public.branches
    WHERE id = '00000000-0000-0000-0000-000000000001'::uuid;

    IF NOT FOUND
       OR v_row.code IS DISTINCT FROM 'BRANCH-A'
       OR v_row.name IS DISTINCT FROM 'Branch A - Jakarta'
       OR v_row.timezone IS DISTINCT FROM 'Asia/Jakarta'
       OR v_row.is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'Post-seed verification failed on public.branches.';
    END IF;
END $$;

COMMIT;

-- ============================================================================
-- CENTRAL ROLLBACK PROCEDURE (REFERENCE ONLY — DO NOT UNCOMMENT FOR SEED RUN)
-- Reverses the BRANCH-A seed safely using row locking (SELECT ... FOR UPDATE)
-- to serialize against concurrent child-table FK inserts (FOR KEY SHARE).
-- ============================================================================
/*
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
    SELECT id INTO v_locked_id
    FROM public.branches
    WHERE id = v_branch_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE NOTICE 'Branch % does not exist on Central; nothing to roll back.', v_branch_id;
        RETURN;
    END IF;

    SELECT EXISTS (SELECT 1 FROM public.employee_directory WHERE branch_id = v_branch_id) INTO v_has_emp_dir;
    SELECT EXISTS (SELECT 1 FROM public.attendance_daily_summaries WHERE branch_id = v_branch_id) INTO v_has_att_sum;
    SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE branch_id = v_branch_id) INTO v_has_profiles;
    SELECT EXISTS (SELECT 1 FROM public.audit_logs WHERE branch_id = v_branch_id) INTO v_has_audits;

    IF v_has_emp_dir OR v_has_att_sum OR v_has_profiles OR v_has_audits THEN
        UPDATE public.branches
        SET is_active = FALSE,
            updated_at = now()
        WHERE id = v_branch_id;

        RAISE NOTICE 'References detected (emp_dir=%, att_sum=%, profiles=%, audits=%). Soft-deactivated BRANCH-A.',
            v_has_emp_dir, v_has_att_sum, v_has_profiles, v_has_audits;
    ELSE
        DELETE FROM public.branches
        WHERE id = v_branch_id
          AND code = 'BRANCH-A';

        RAISE NOTICE 'Verified zero child references under FOR UPDATE lock; deleted BRANCH-A seed row.';
    END IF;
END $$;

COMMIT;
*/
