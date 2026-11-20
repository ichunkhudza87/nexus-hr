-- ============================================================================
-- NEXUS HR — PHASE 3.12E.1: TARGETED CONFIG COMPATIBILITY REMEDIATION V2.7.2
-- Target Database: nexus-branch-a (Supabase Project Ref: uneycmbqqpkifwhwzbes)
-- Baseline: 002_branch_a_schema.sql (preserved unmodified)
-- Execution Order: MUST run BEFORE 001_branch_a_security_remediation_v2_7_1.sql
-- Status: LOCAL DRAFT ONLY — NOT EXECUTED ON REMOTE SUPABASE
-- ============================================================================
-- Resolves Phase 3.12E Finding [E-01]:
--   002_branch_a_schema.sql defines public.branch_config without is_active,
--   whereas 001_branch_a_security_remediation_v2_7_1.sql (L59, L433, L437)
--   requires public.branch_config.is_active BOOLEAN NOT NULL DEFAULT TRUE.
-- ============================================================================

BEGIN;

DO $$
DECLARE
    v_row_count BIGINT;
    v_before RECORD;
    v_after RECORD;
    v_col_type TEXT;
    v_attnotnull BOOLEAN;
    v_default_expr TEXT;
    v_null_count BIGINT;
BEGIN
    -- 1. Preconditions: table and canonical BRANCH-A singleton must already exist
    IF to_regclass('public.branch_config') IS NULL THEN
        RAISE EXCEPTION 'Precondition failed (v2.7.2): public.branch_config does not exist.';
    END IF;

    SELECT count(*) INTO v_row_count FROM public.branch_config;
    IF v_row_count <> 1 THEN
        RAISE EXCEPTION 'Precondition failed (v2.7.2): expected exactly 1 row in public.branch_config, found %.', v_row_count;
    END IF;

    SELECT id,
           branch_code,
           branch_name,
           operating_timezone,
           attendance_grace_period_mins,
           max_overtime_hours_per_day
    INTO v_before
    FROM public.branch_config
    LIMIT 1;

    IF v_before.id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid
       OR v_before.branch_code IS DISTINCT FROM 'BRANCH-A' THEN
        RAISE EXCEPTION 'Precondition failed (v2.7.2): branch_config identity (id=%, branch_code=%) does not match BRANCH-A.',
            v_before.id, v_before.branch_code;
    END IF;

    -- 2. Inspect current catalog state of public.branch_config.is_active
    SELECT format_type(a.atttypid, a.atttypmod),
           a.attnotnull
    INTO v_col_type, v_attnotnull
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'branch_config'
      AND a.attname = 'is_active'
      AND NOT a.attisdropped;

    IF NOT FOUND THEN
        -- Fresh baseline path: add is_active BOOLEAN NOT NULL DEFAULT TRUE without rewriting unrelated fields
        EXECUTE 'ALTER TABLE public.branch_config ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE';
        RAISE NOTICE 'v2.7.2: Added public.branch_config.is_active BOOLEAN NOT NULL DEFAULT TRUE.';
    ELSE
        -- Idempotent / existing-column path: verify compatible type, preserve explicit FALSE, handle NULLs
        IF v_col_type IS DISTINCT FROM 'boolean' THEN
            RAISE EXCEPTION 'Compatibility halted (v2.7.2): public.branch_config.is_active has incompatible type % (expected boolean).',
                v_col_type;
        END IF;

        IF NOT v_attnotnull THEN
            SELECT count(*) INTO v_null_count
            FROM public.branch_config
            WHERE is_active IS NULL;

            IF v_null_count > 0 THEN
                -- Documented policy: canonical BRANCH-A singleton defaults to active (TRUE) when NULL;
                -- any explicit FALSE value is preserved untouched.
                UPDATE public.branch_config
                SET is_active = TRUE
                WHERE is_active IS NULL;
                RAISE NOTICE 'v2.7.2: Backfilled % NULL is_active row(s) to TRUE on BRANCH-A.', v_null_count;
            END IF;
        END IF;

        EXECUTE 'ALTER TABLE public.branch_config ALTER COLUMN is_active SET DEFAULT TRUE';
        EXECUTE 'ALTER TABLE public.branch_config ALTER COLUMN is_active SET NOT NULL';
        RAISE NOTICE 'v2.7.2: Verified/enforced public.branch_config.is_active BOOLEAN NOT NULL DEFAULT TRUE.';
    END IF;

    -- 3. Post-migration fail-fast validation
    SELECT count(*) INTO v_row_count FROM public.branch_config;
    IF v_row_count <> 1 THEN
        RAISE EXCEPTION 'Post-check failed (v2.7.2): unexpected row count % in public.branch_config.', v_row_count;
    END IF;

    SELECT id,
           branch_code,
           branch_name,
           operating_timezone,
           attendance_grace_period_mins,
           max_overtime_hours_per_day
    INTO v_after
    FROM public.branch_config
    LIMIT 1;

    IF v_after.id IS DISTINCT FROM v_before.id
       OR v_after.branch_code IS DISTINCT FROM v_before.branch_code
       OR v_after.branch_name IS DISTINCT FROM v_before.branch_name
       OR v_after.operating_timezone IS DISTINCT FROM v_before.operating_timezone
       OR v_after.attendance_grace_period_mins IS DISTINCT FROM v_before.attendance_grace_period_mins
       OR v_after.max_overtime_hours_per_day IS DISTINCT FROM v_before.max_overtime_hours_per_day THEN
        RAISE EXCEPTION 'Post-check failed (v2.7.2): unrelated branch_config fields were altered.';
    END IF;

    SELECT format_type(a.atttypid, a.atttypmod),
           a.attnotnull,
           pg_get_expr(d.adbin, d.adrelid)
    INTO v_col_type, v_attnotnull, v_default_expr
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public'
      AND c.relname = 'branch_config'
      AND a.attname = 'is_active'
      AND NOT a.attisdropped;

    IF v_col_type IS DISTINCT FROM 'boolean'
       OR v_attnotnull IS NOT TRUE
       OR lower(COALESCE(v_default_expr, '')) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Post-check failed (v2.7.2): is_active catalog check failed (type=%, notnull=%, default=%).',
            v_col_type, v_attnotnull, v_default_expr;
    END IF;
END $$;

COMMIT;
