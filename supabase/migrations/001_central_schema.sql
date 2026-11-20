-- ============================================================================
-- NEXUS HR — CENTRAL DATABASE MIGRATION SCRIPT
-- Node 1: nexus-central (Supabase Project Ref: wcmevigbqsmzsdqidjel)
-- Database Engine: PostgreSQL 17
-- Architecture Version: v2.0.0
-- Standard Timestamp Strategy: TIMESTAMPTZ (Stored in UTC, Displayed in Asia/Jakarta)
--
-- Tables (Exactly 7 Application Tables):
--   1. branches
--   2. user_profiles
--   3. employee_directory
--   4. attendance_daily_summaries
--   5. sync_inbox
--   6. sync_runs
--   7. audit_logs
-- ============================================================================

-- Ensure required extensions are active
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. UTILITY FUNCTIONS
-- ============================================================================

-- Automatic updated_at timestamp manager
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Helper to safely extract user_role claim from Supabase Auth JWT
CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS TEXT AS $$
BEGIN
    RETURN COALESCE(
        current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'user_role',
        auth.jwt() -> 'app_metadata' ->> 'user_role',
        'EMPLOYEE'
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN 'EMPLOYEE';
END;
$$ LANGUAGE plpgsql STABLE;

-- Helper to safely extract branch_id claim from Supabase Auth JWT
CREATE OR REPLACE FUNCTION public.get_auth_branch_id()
RETURNS UUID AS $$
DECLARE
    v_branch_id TEXT;
BEGIN
    v_branch_id := COALESCE(
        current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'branch_id',
        auth.jwt() -> 'app_metadata' ->> 'branch_id'
    );
    IF v_branch_id IS NULL OR v_branch_id = '' THEN
        RETURN NULL;
    END IF;
    RETURN v_branch_id::uuid;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- 2. APPLICATION TABLES & CONSTRAINTS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table 1: branches
-- Master corporate registry of operational and administrative branches
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Jakarta',
    address TEXT,
    phone_number VARCHAR(50),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_branches_code UNIQUE (code),
    CONSTRAINT chk_branches_code_format CHECK (code ~ '^[A-Z0-9\-_]+$')
);

CREATE INDEX IF NOT EXISTS idx_branches_code ON public.branches (code);
CREATE INDEX IF NOT EXISTS idx_branches_is_active ON public.branches (is_active);

CREATE TRIGGER trg_branches_updated_at
    BEFORE UPDATE ON public.branches
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Table 2: user_profiles
-- Application identity profile bound 1:1 to Central Supabase Auth
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'EMPLOYEE',
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    avatar_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_profiles_email UNIQUE (email),
    CONSTRAINT chk_user_profiles_role CHECK (
        role IN ('SUPERADMIN', 'CENTRAL_HR', 'BRANCH_MANAGER', 'BRANCH_HR', 'EMPLOYEE')
    ),
    CONSTRAINT chk_branch_assignment CHECK (
        (role IN ('SUPERADMIN', 'CENTRAL_HR')) OR (branch_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON public.user_profiles (email);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON public.user_profiles (role);
CREATE INDEX IF NOT EXISTS idx_user_profiles_branch_id ON public.user_profiles (branch_id);

CREATE TRIGGER trg_user_profiles_updated_at
    BEFORE UPDATE ON public.user_profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Table 3: employee_directory
-- Read-only synchronized projection of branch employees across all branches
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_directory (
    id UUID PRIMARY KEY, -- Matches Branch A employees.id exactly
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
    employee_code VARCHAR(50) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(255),
    department_name VARCHAR(100),
    position_title VARCHAR(100),
    employment_status VARCHAR(50) NOT NULL DEFAULT 'PERMANENT',
    join_date DATE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_emp_dir_branch_code UNIQUE (branch_id, employee_code),
    CONSTRAINT chk_emp_dir_status CHECK (
        employment_status IN ('PERMANENT', 'CONTRACT', 'INTERN', 'PROBATION')
    )
);

CREATE INDEX IF NOT EXISTS idx_emp_dir_branch_lookup ON public.employee_directory (branch_id, employee_code);
CREATE INDEX IF NOT EXISTS idx_emp_dir_full_name ON public.employee_directory (full_name);
CREATE INDEX IF NOT EXISTS idx_emp_dir_status ON public.employee_directory (is_active, employment_status);

CREATE TRIGGER trg_employee_directory_updated_at
    BEFORE UPDATE ON public.employee_directory
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Table 4: attendance_daily_summaries
-- Consolidated daily attendance rollups from branch nodes for corporate reporting
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_daily_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
    summary_date DATE NOT NULL,
    total_employees INT NOT NULL DEFAULT 0,
    present_count INT NOT NULL DEFAULT 0,
    late_count INT NOT NULL DEFAULT 0,
    absent_count INT NOT NULL DEFAULT 0,
    leave_count INT NOT NULL DEFAULT 0,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_att_summary_branch_date UNIQUE (branch_id, summary_date),
    CONSTRAINT chk_att_summary_non_negative CHECK (
        total_employees >= 0 AND
        present_count >= 0 AND
        late_count >= 0 AND
        absent_count >= 0 AND
        leave_count >= 0
    ),
    CONSTRAINT chk_att_summary_capacity CHECK (
        present_count + late_count + absent_count + leave_count <= total_employees
    )
);

CREATE INDEX IF NOT EXISTS idx_att_summary_lookup ON public.attendance_daily_summaries (branch_id, summary_date DESC);

CREATE TRIGGER trg_att_summary_updated_at
    BEFORE UPDATE ON public.attendance_daily_summaries
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Table 5: sync_inbox
-- Inbound transactional staging queue ensuring idempotent event ingestion
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sync_inbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL,
    source_node VARCHAR(50) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id UUID NOT NULL,
    aggregate_version BIGINT NOT NULL DEFAULT 1,
    schema_version INT NOT NULL DEFAULT 1,
    payload JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'RECEIVED',
    locked_by VARCHAR(100),
    locked_at TIMESTAMPTZ,
    error_message TEXT,
    retry_count INT NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    CONSTRAINT uq_sync_inbox_event_id UNIQUE (event_id),
    CONSTRAINT chk_sync_inbox_status CHECK (
        status IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD_LETTER')
    )
);

CREATE INDEX IF NOT EXISTS idx_sync_inbox_event_id ON public.sync_inbox (event_id);
CREATE INDEX IF NOT EXISTS idx_sync_inbox_processing_queue ON public.sync_inbox (status, next_retry_at, received_at)
    WHERE status IN ('RECEIVED', 'FAILED');
CREATE INDEX IF NOT EXISTS idx_sync_inbox_aggregate ON public.sync_inbox (aggregate_type, aggregate_id);

-- ----------------------------------------------------------------------------
-- Table 6: sync_runs
-- Batch execution telemetry and monitoring audit logs for synchronization
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sync_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_node VARCHAR(50) NOT NULL,
    target_node VARCHAR(50) NOT NULL DEFAULT 'CENTRAL',
    batch_size INT NOT NULL,
    events_synced INT NOT NULL DEFAULT 0,
    events_failed INT NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'IN_PROGRESS',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    log_summary JSONB,
    CONSTRAINT chk_sync_runs_batch CHECK (batch_size >= 0),
    CONSTRAINT chk_sync_runs_synced CHECK (events_synced >= 0),
    CONSTRAINT chk_sync_runs_failed CHECK (events_failed >= 0),
    CONSTRAINT chk_sync_runs_status CHECK (
        status IN ('IN_PROGRESS', 'SUCCESS', 'PARTIAL_FAILURE', 'FAILED')
    )
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON public.sync_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_runs_status ON public.sync_runs (status);

-- ----------------------------------------------------------------------------
-- Table 7: audit_logs
-- Append-only immutable corporate security and administrative audit log
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID,
    actor_email VARCHAR(255),
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_central_created ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_central_entity ON public.audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_central_actor ON public.audit_logs (actor_id);

-- Enforce strict append-only immutability at PostgreSQL privilege level
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM authenticated, anon, public;

-- ============================================================================
-- 3. AUDIT & IDENTITY AUTOMATION TRIGGERS
-- ============================================================================

-- Automatic user profile creation on Supabase Auth signup
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_branch_id UUID;
    v_role TEXT;
    v_full_name TEXT;
BEGIN
    v_role := COALESCE(NEW.raw_app_meta_data ->> 'user_role', 'EMPLOYEE');
    v_full_name := COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1));
    
    IF NEW.raw_app_meta_data ? 'branch_id' THEN
        v_branch_id := (NEW.raw_app_meta_data ->> 'branch_id')::uuid;
    ELSE
        v_branch_id := NULL;
    END IF;

    INSERT INTO public.user_profiles (id, email, full_name, role, branch_id, is_active)
    VALUES (NEW.id, NEW.email, v_full_name, v_role, v_branch_id, TRUE)
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role,
        branch_id = EXCLUDED.branch_id,
        updated_at = now();

    RETURN NEW;
END;
$$;

-- Attach trigger to auth.users if available
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') AND
       EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'auth' AND tablename = 'users') THEN
        DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
        CREATE TRIGGER on_auth_user_created
            AFTER INSERT ON auth.users
            FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
    END IF;
END $$;

-- Central audit trail logging trigger function
CREATE OR REPLACE FUNCTION public.record_central_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id UUID;
    v_actor_email VARCHAR(255);
    v_branch_id UUID;
    v_action VARCHAR(100);
    v_old_values JSONB := NULL;
    v_new_values JSONB := NULL;
    v_entity_id UUID := NULL;
BEGIN
    v_actor_id := auth.uid();
    v_actor_email := COALESCE(
        current_setting('request.jwt.claims', true)::jsonb ->> 'email',
        auth.jwt() ->> 'email'
    );
    v_branch_id := public.get_auth_branch_id();

    IF TG_OP = 'INSERT' THEN
        v_action := TG_TABLE_NAME || '_CREATED';
        v_new_values := to_jsonb(NEW);
        v_entity_id := NEW.id;
    ELSIF TG_OP = 'UPDATE' THEN
        v_action := TG_TABLE_NAME || '_UPDATED';
        v_old_values := to_jsonb(OLD);
        v_new_values := to_jsonb(NEW);
        v_entity_id := NEW.id;
    ELSIF TG_OP = 'DELETE' THEN
        v_action := TG_TABLE_NAME || '_DELETED';
        v_old_values := to_jsonb(OLD);
        v_entity_id := OLD.id;
    END IF;

    INSERT INTO public.audit_logs (
        actor_id, actor_email, branch_id, action,
        entity_type, entity_id, old_values, new_values,
        created_at
    ) VALUES (
        v_actor_id, v_actor_email, v_branch_id, v_action,
        TG_TABLE_NAME, v_entity_id, v_old_values, v_new_values,
        now()
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

-- Attach audit triggers to core central tables
CREATE TRIGGER trg_audit_branches
    AFTER INSERT OR UPDATE OR DELETE ON public.branches
    FOR EACH ROW EXECUTE FUNCTION public.record_central_audit_log();

CREATE TRIGGER trg_audit_user_profiles
    AFTER INSERT OR UPDATE OR DELETE ON public.user_profiles
    FOR EACH ROW EXECUTE FUNCTION public.record_central_audit_log();

-- ============================================================================
-- 4. INBOX MATERIALIZATION & CONCURRENCY CONTROL FUNCTIONS
-- ============================================================================

-- Projection Materializer: Ingests an event into projections transactionally
CREATE OR REPLACE FUNCTION public.apply_inbox_event_projection(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_event RECORD;
    v_p JSONB;
    v_branch_id UUID;
BEGIN
    SELECT * INTO v_event FROM public.sync_inbox WHERE event_id = p_event_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event % not found in sync_inbox', p_event_id;
    END IF;

    -- Idempotent early exit if already processed
    IF v_event.status = 'PROCESSED' THEN
        RETURN TRUE;
    END IF;

    v_p := v_event.payload;

    -- Case 1: Employee Upserted
    IF v_event.event_type = 'EMPLOYEE_UPSERTED' THEN
        SELECT id INTO v_branch_id FROM public.branches WHERE code = (v_p ->> 'branch_code');
        IF v_branch_id IS NULL THEN
            RAISE EXCEPTION 'Target branch % does not exist in central registry', (v_p ->> 'branch_code');
        END IF;

        INSERT INTO public.employee_directory (
            id, branch_id, employee_code, full_name, email,
            department_name, position_title, employment_status,
            join_date, is_active, last_synced_at, version
        ) VALUES (
            (v_p ->> 'id')::uuid,
            v_branch_id,
            v_p ->> 'employee_code',
            v_p ->> 'full_name',
            v_p ->> 'email',
            v_p ->> 'department_name',
            v_p ->> 'position_title',
            v_p ->> 'employment_status',
            (v_p ->> 'join_date')::date,
            (v_p ->> 'is_active')::boolean,
            now(),
            (v_p ->> 'version')::bigint
        )
        ON CONFLICT (id) DO UPDATE
        SET branch_id = EXCLUDED.branch_id,
            employee_code = EXCLUDED.employee_code,
            full_name = EXCLUDED.full_name,
            email = EXCLUDED.email,
            department_name = EXCLUDED.department_name,
            position_title = EXCLUDED.position_title,
            employment_status = EXCLUDED.employment_status,
            join_date = EXCLUDED.join_date,
            is_active = EXCLUDED.is_active,
            last_synced_at = now(),
            version = EXCLUDED.version,
            updated_at = now()
        WHERE EXCLUDED.version > public.employee_directory.version; -- Stale event protection

    -- Case 2: Employee Deactivated (Soft delete projection)
    ELSIF v_event.event_type = 'EMPLOYEE_DEACTIVATED' THEN
        UPDATE public.employee_directory
        SET is_active = FALSE,
            last_synced_at = now(),
            version = (v_p ->> 'version')::bigint,
            updated_at = now()
        WHERE id = (v_p ->> 'id')::uuid
          AND (v_p ->> 'version')::bigint > public.employee_directory.version;

    -- Case 3: Attendance Daily Summary Rollup
    ELSIF v_event.event_type = 'ATTENDANCE_SUMMARY_RECORDED' THEN
        SELECT id INTO v_branch_id FROM public.branches WHERE code = (v_p ->> 'branch_code');
        IF v_branch_id IS NULL THEN
            RAISE EXCEPTION 'Target branch % does not exist for attendance summary', (v_p ->> 'branch_code');
        END IF;

        INSERT INTO public.attendance_daily_summaries (
            branch_id, summary_date, total_employees, present_count,
            late_count, absent_count, leave_count, last_synced_at, source_version
        ) VALUES (
            v_branch_id,
            (v_p ->> 'summary_date')::date,
            (v_p ->> 'total_employees')::int,
            (v_p ->> 'present_count')::int,
            (v_p ->> 'late_count')::int,
            (v_p ->> 'absent_count')::int,
            (v_p ->> 'leave_count')::int,
            now(),
            (v_p ->> 'source_version')::bigint
        )
        ON CONFLICT (branch_id, summary_date) DO UPDATE
        SET total_employees = EXCLUDED.total_employees,
            present_count = EXCLUDED.present_count,
            late_count = EXCLUDED.late_count,
            absent_count = EXCLUDED.absent_count,
            leave_count = EXCLUDED.leave_count,
            last_synced_at = now(),
            source_version = EXCLUDED.source_version,
            updated_at = now()
        WHERE EXCLUDED.source_version > public.attendance_daily_summaries.source_version; -- Monotonic rollup check
    END IF;

    -- Transition inbox status to PROCESSED
    UPDATE public.sync_inbox
    SET status = 'PROCESSED',
        processed_at = now(),
        locked_by = NULL,
        locked_at = NULL,
        error_message = NULL
    WHERE event_id = p_event_id;

    RETURN TRUE;
EXCEPTION
    WHEN OTHERS THEN
        UPDATE public.sync_inbox
        SET status = 'FAILED',
            retry_count = retry_count + 1,
            next_retry_at = now() + (POWER(2, LEAST(retry_count + 1, 6)) * INTERVAL '1 second'),
            error_message = SQLERRM,
            locked_by = NULL,
            locked_at = NULL
        WHERE event_id = p_event_id;

        -- If retries exceed 5, transition to DEAD_LETTER
        UPDATE public.sync_inbox
        SET status = 'DEAD_LETTER'
        WHERE event_id = p_event_id AND retry_count >= 5;

        RETURN FALSE;
END;
$$;

-- Batch lease claim helper for Central sync consumer worker
CREATE OR REPLACE FUNCTION public.claim_inbox_batch(
    p_worker_id VARCHAR(100),
    p_batch_size INT DEFAULT 50
)
RETURNS TABLE (
    event_id UUID,
    event_type VARCHAR(100),
    aggregate_type VARCHAR(100),
    aggregate_id UUID,
    payload JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    WITH eligible AS (
        SELECT id
        FROM public.sync_inbox
        WHERE (status = 'RECEIVED' AND (next_retry_at IS NULL OR next_retry_at <= now()))
           OR (status = 'PROCESSING' AND locked_at < now() - INTERVAL '5 minutes') -- Expired lease recovery
        ORDER BY received_at ASC
        LIMIT p_batch_size
        FOR UPDATE SKIP LOCKED
    ),
    claimed AS (
        UPDATE public.sync_inbox
        SET status = 'PROCESSING',
            locked_by = p_worker_id,
            locked_at = now()
        WHERE id IN (SELECT id FROM eligible)
        RETURNING public.sync_inbox.event_id, public.sync_inbox.event_type,
                  public.sync_inbox.aggregate_type, public.sync_inbox.aggregate_id,
                  public.sync_inbox.payload
    )
    SELECT * FROM claimed;
END;
$$;

-- ============================================================================
-- 5. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_daily_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- RLS Policies: branches
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "branches_select_authenticated" ON public.branches;
CREATE POLICY "branches_select_authenticated" ON public.branches
    FOR SELECT TO authenticated
    USING (is_active = TRUE OR public.get_auth_role() = 'SUPERADMIN');

DROP POLICY IF EXISTS "branches_admin_manage" ON public.branches;
CREATE POLICY "branches_admin_manage" ON public.branches
    FOR ALL TO authenticated
    USING (public.get_auth_role() = 'SUPERADMIN')
    WITH CHECK (public.get_auth_role() = 'SUPERADMIN');

-- ----------------------------------------------------------------------------
-- RLS Policies: user_profiles
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "user_profiles_select_policy" ON public.user_profiles;
CREATE POLICY "user_profiles_select_policy" ON public.user_profiles
    FOR SELECT TO authenticated
    USING (
        id = auth.uid() OR
        public.get_auth_role() IN ('SUPERADMIN', 'CENTRAL_HR') OR
        (branch_id IS NOT NULL AND branch_id = public.get_auth_branch_id())
    );

DROP POLICY IF EXISTS "user_profiles_update_self" ON public.user_profiles;
CREATE POLICY "user_profiles_update_self" ON public.user_profiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid())
    WITH CHECK (
        id = auth.uid() AND
        role = (SELECT role FROM public.user_profiles WHERE id = auth.uid()) -- Prevents self role-elevation
    );

DROP POLICY IF EXISTS "user_profiles_admin_manage" ON public.user_profiles;
CREATE POLICY "user_profiles_admin_manage" ON public.user_profiles
    FOR ALL TO authenticated
    USING (public.get_auth_role() = 'SUPERADMIN')
    WITH CHECK (public.get_auth_role() = 'SUPERADMIN');

-- ----------------------------------------------------------------------------
-- RLS Policies: employee_directory
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "employee_directory_select" ON public.employee_directory;
CREATE POLICY "employee_directory_select" ON public.employee_directory
    FOR SELECT TO authenticated
    USING (
        public.get_auth_role() IN ('SUPERADMIN', 'CENTRAL_HR') OR
        (branch_id = public.get_auth_branch_id())
    );

-- Mutations are revoked from authenticated/anon; restricted to service_role (sync consumer)

-- ----------------------------------------------------------------------------
-- RLS Policies: attendance_daily_summaries
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "attendance_summaries_select" ON public.attendance_daily_summaries;
CREATE POLICY "attendance_summaries_select" ON public.attendance_daily_summaries
    FOR SELECT TO authenticated
    USING (
        public.get_auth_role() IN ('SUPERADMIN', 'CENTRAL_HR') OR
        (branch_id = public.get_auth_branch_id())
    );

-- ----------------------------------------------------------------------------
-- RLS Policies: sync_runs
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "sync_runs_select_admin" ON public.sync_runs;
CREATE POLICY "sync_runs_select_admin" ON public.sync_runs
    FOR SELECT TO authenticated
    USING (public.get_auth_role() = 'SUPERADMIN');

-- ----------------------------------------------------------------------------
-- RLS Policies: audit_logs
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "audit_logs_select_admin" ON public.audit_logs;
CREATE POLICY "audit_logs_select_admin" ON public.audit_logs
    FOR SELECT TO authenticated
    USING (public.get_auth_role() = 'SUPERADMIN');

-- ============================================================================
-- 6. DATABASE GRANTS & SECURITY BOUNDARIES
-- ============================================================================

-- Grant appropriate usage to authenticated users
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.branches TO authenticated;
GRANT SELECT, UPDATE ON public.user_profiles TO authenticated;
GRANT SELECT ON public.employee_directory TO authenticated;
GRANT SELECT ON public.attendance_daily_summaries TO authenticated;
GRANT SELECT ON public.sync_runs TO authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;

-- Service role grants for backend workers
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Revoke all public / anonymous permissions on sensitive sync tables
REVOKE ALL ON public.sync_inbox FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.employee_directory FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.attendance_daily_summaries FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.sync_runs FROM anon, authenticated;

-- ============================================================================
-- END OF CENTRAL DATABASE MIGRATION SCRIPT
-- ============================================================================
