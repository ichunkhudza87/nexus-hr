-- ============================================================================
-- NEXUS HR — BRANCH A DATABASE MIGRATION SCRIPT
-- Node 2: nexus-branch-a (Supabase Project Ref: uneycmbqqpkifwhwzbes)
-- Database Engine: PostgreSQL 17
-- Architecture Version: v2.0.0
-- Standard Timestamp Strategy: TIMESTAMPTZ (Stored in UTC, Displayed in Asia/Jakarta)
--
-- Tables (Exactly 10 Application Tables):
--   1. branch_config
--   2. departments
--   3. positions
--   4. employees
--   5. shifts
--   6. employee_schedules
--   7. attendance
--   8. leave_requests
--   9. sync_outbox
--   10. audit_logs
-- ============================================================================

-- Ensure required extensions are active
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. UTILITY FUNCTIONS & SEQUENCES
-- ============================================================================

-- Sequence for Branch A employee badge codes (EMP-A-0001, EMP-A-0002, ...)
CREATE SEQUENCE IF NOT EXISTS public.seq_branch_a_employee_code START WITH 1 INCREMENT BY 1;

-- Automatic updated_at timestamp manager
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Helper to safely extract user_role claim from verified JWT context
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

-- Helper to look up current employee UUID based on authenticated user auth ID
CREATE OR REPLACE FUNCTION public.get_current_employee_id()
RETURNS UUID AS $$
DECLARE
    v_emp_id UUID;
BEGIN
    SELECT id INTO v_emp_id
    FROM public.employees
    WHERE user_auth_id = auth.uid()
      AND is_deleted = FALSE
    LIMIT 1;
    RETURN v_emp_id;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- 2. APPLICATION TABLES & RELATIONAL INTEGRITY CONSTRAINTS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table 1: branch_config
-- Local deterministic singleton configuration for Branch A
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.branch_config (
    id UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
    branch_code VARCHAR(20) NOT NULL DEFAULT 'BRANCH-A',
    branch_name VARCHAR(100) NOT NULL DEFAULT 'Branch A - Jakarta',
    operating_timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Jakarta',
    attendance_grace_period_mins INT NOT NULL DEFAULT 15,
    max_overtime_hours_per_day NUMERIC(4,2) NOT NULL DEFAULT 4.00,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_branch_config_singleton CHECK (id = '00000000-0000-0000-0000-000000000001'::uuid),
    CONSTRAINT uq_branch_config_code UNIQUE (branch_code),
    CONSTRAINT chk_grace_period CHECK (attendance_grace_period_mins >= 0),
    CONSTRAINT chk_max_overtime CHECK (max_overtime_hours_per_day >= 0)
);

CREATE TRIGGER trg_branch_config_updated_at
    BEFORE UPDATE ON public.branch_config
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed initial singleton configuration if absent
INSERT INTO public.branch_config (id, branch_code, branch_name)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'BRANCH-A', 'Branch A - Jakarta')
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Table 2: departments
-- Master organizational departments for Branch A
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_departments_code UNIQUE (code),
    CONSTRAINT chk_departments_code_format CHECK (code ~ '^[A-Z0-9\-_]+$')
);

CREATE INDEX IF NOT EXISTS idx_dept_code ON public.departments (code);
CREATE INDEX IF NOT EXISTS idx_dept_is_active ON public.departments (is_active);

CREATE TRIGGER trg_departments_updated_at
    BEFORE UPDATE ON public.departments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Table 3: positions
-- Master job titles and hierarchy grades within departments
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
    code VARCHAR(20) NOT NULL,
    title VARCHAR(100) NOT NULL,
    grade_level VARCHAR(20),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_positions_code UNIQUE (code),
    CONSTRAINT uq_positions_id_dept UNIQUE (id, department_id), -- Required for composite FK
    CONSTRAINT chk_positions_code_format CHECK (code ~ '^[A-Z0-9\-_]+$')
);

CREATE INDEX IF NOT EXISTS idx_positions_dept ON public.positions (department_id);
CREATE INDEX IF NOT EXISTS idx_positions_code ON public.positions (code);

CREATE TRIGGER trg_positions_updated_at
    BEFORE UPDATE ON public.positions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Table 4: employees
-- Operational employee master with soft-delete support
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_code VARCHAR(50) NOT NULL,
    user_auth_id UUID, -- Logical pointer to Central auth.users.id
    department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
    position_id UUID NOT NULL REFERENCES public.positions(id) ON DELETE RESTRICT,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone_number VARCHAR(50),
    employment_status VARCHAR(50) NOT NULL DEFAULT 'PERMANENT',
    join_date DATE NOT NULL,
    resignation_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_employees_code UNIQUE (employee_code),
    CONSTRAINT uq_employees_email UNIQUE (email),
    -- Composite FK: Guarantees position belongs to the assigned department
    CONSTRAINT fk_employee_position_dept
        FOREIGN KEY (position_id, department_id)
        REFERENCES public.positions(id, department_id)
        ON DELETE RESTRICT,
    CONSTRAINT chk_employees_status CHECK (
        employment_status IN ('PERMANENT', 'CONTRACT', 'INTERN', 'PROBATION')
    ),
    CONSTRAINT chk_employees_resignation CHECK (
        resignation_date IS NULL OR resignation_date >= join_date
    )
);

CREATE INDEX IF NOT EXISTS idx_employees_code ON public.employees (employee_code);
CREATE INDEX IF NOT EXISTS idx_employees_email ON public.employees (email);
CREATE INDEX IF NOT EXISTS idx_employees_dept_pos ON public.employees (department_id, position_id);
CREATE INDEX IF NOT EXISTS idx_employees_active ON public.employees (is_active) WHERE is_deleted = FALSE;

CREATE TRIGGER trg_employees_updated_at
    BEFORE UPDATE ON public.employees
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Table 5: shifts
-- Work shift definitions supporting regular and overnight timeframes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_overnight BOOLEAN NOT NULL DEFAULT FALSE,
    break_duration_mins INT NOT NULL DEFAULT 60,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_shifts_code UNIQUE (code),
    CONSTRAINT chk_shifts_code_format CHECK (code ~ '^[A-Z0-9\-_]+$'),
    CONSTRAINT chk_break_duration CHECK (break_duration_mins >= 0),
    -- Overnight Chronology Constraint
    CONSTRAINT chk_shift_overnight_chronology CHECK (
        (is_overnight = FALSE AND end_time > start_time) OR
        (is_overnight = TRUE AND end_time <= start_time)
    )
);

CREATE INDEX IF NOT EXISTS idx_shifts_code ON public.shifts (code);
CREATE INDEX IF NOT EXISTS idx_shifts_is_active ON public.shifts (is_active);

CREATE TRIGGER trg_shifts_updated_at
    BEFORE UPDATE ON public.shifts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Table 6: employee_schedules
-- Roster assignments (strictly one shift per employee per calendar day)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE RESTRICT,
    schedule_date DATE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'SCHEDULED',
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_schedules_id_emp UNIQUE (id, employee_id), -- Required for composite FK
    CONSTRAINT chk_schedules_status CHECK (
        status IN ('SCHEDULED', 'SWAPPED', 'CANCELLED', 'LEAVE', 'OFF')
    )
);

-- Phase 1 Business Rule: Strictly one active schedule per employee per calendar day
CREATE UNIQUE INDEX IF NOT EXISTS uq_schedules_emp_date_active
    ON public.employee_schedules (employee_id, schedule_date)
    WHERE (status != 'CANCELLED');

CREATE INDEX IF NOT EXISTS idx_schedules_emp_lookup ON public.employee_schedules (employee_id, schedule_date);
CREATE INDEX IF NOT EXISTS idx_schedules_date ON public.employee_schedules (schedule_date);

CREATE TRIGGER trg_employee_schedules_updated_at
    BEFORE UPDATE ON public.employee_schedules
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Table 7: attendance
-- Operational check-in/out records bound 1:1 to schedules
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    attendance_date DATE NOT NULL,
    check_in_time TIMESTAMPTZ NOT NULL,
    check_out_time TIMESTAMPTZ,
    status VARCHAR(50) NOT NULL DEFAULT 'ON_TIME',
    check_in_method VARCHAR(50) NOT NULL DEFAULT 'MANUAL_WEB',
    check_out_method VARCHAR(50),
    check_in_notes TEXT,
    check_out_notes TEXT,
    check_in_ip VARCHAR(45),
    check_out_ip VARCHAR(45),
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Strict 1:1 binding to schedule
    CONSTRAINT uq_attendance_schedule UNIQUE (schedule_id),
    -- Composite FK: Guarantees check-in belongs to the rostered employee
    CONSTRAINT fk_attendance_schedule_employee
        FOREIGN KEY (schedule_id, employee_id)
        REFERENCES public.employee_schedules(id, employee_id)
        ON DELETE RESTRICT,
    CONSTRAINT chk_attendance_status CHECK (
        status IN ('ON_TIME', 'LATE', 'EARLY_DEPARTURE', 'OVERTIME', 'INCOMPLETE', 'ABSENT')
    ),
    -- Chronology cap: Check-out must follow check-in and cannot exceed 24-hour shift window
    CONSTRAINT chk_attendance_checkout_chronology CHECK (
        check_out_time IS NULL OR (
            check_out_time > check_in_time AND
            check_out_time <= check_in_time + INTERVAL '24 hours'
        )
    )
);

CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON public.attendance (employee_id, attendance_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance (attendance_date);

CREATE TRIGGER trg_attendance_updated_at
    BEFORE UPDATE ON public.attendance
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Table 8: leave_requests
-- Leave applications and Branch Manager approval lifecycle
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    leave_type VARCHAR(50) NOT NULL DEFAULT 'ANNUAL',
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days NUMERIC(4,1) NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_leave_types CHECK (
        leave_type IN ('ANNUAL', 'SICK', 'MATERNITY', 'UNPAID', 'SPECIAL_PERMISSION')
    ),
    CONSTRAINT chk_leave_status CHECK (
        status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')
    ),
    CONSTRAINT chk_leave_dates CHECK (end_date >= start_date),
    CONSTRAINT chk_leave_days_positive CHECK (total_days > 0),
    CONSTRAINT chk_leave_rejection_reason CHECK (
        status != 'REJECTED' OR rejection_reason IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_leave_emp_status ON public.leave_requests (employee_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_dates ON public.leave_requests (start_date, end_date);

CREATE TRIGGER trg_leave_requests_updated_at
    BEFORE UPDATE ON public.leave_requests
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Table 9: sync_outbox
-- Transactional outbox staging domain events for asynchronous relay to Central
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sync_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id UUID NOT NULL,
    aggregate_version BIGINT NOT NULL DEFAULT 1,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    locked_by VARCHAR(100),
    locked_at TIMESTAMPTZ,
    retry_count INT NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,
    CONSTRAINT uq_sync_outbox_event_id UNIQUE (event_id),
    CONSTRAINT chk_sync_outbox_status CHECK (
        status IN ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED')
    )
);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_queue ON public.sync_outbox (status, next_retry_at, created_at)
    WHERE status IN ('PENDING', 'PROCESSING', 'FAILED');
CREATE INDEX IF NOT EXISTS idx_sync_outbox_event_id ON public.sync_outbox (event_id);

-- ----------------------------------------------------------------------------
-- Table 10: audit_logs
-- Local append-only operational audit log for Branch A
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID,
    actor_email VARCHAR(255),
    branch_id UUID,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_branch_created ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_branch_entity ON public.audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_branch_actor ON public.audit_logs (actor_id);

-- Enforce strict append-only immutability
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM authenticated, anon, public;

-- ============================================================================
-- 3. DOMAIN TRIGGERS & BUSINESS LOGIC ENFORCEMENT
-- ============================================================================

-- Concurrency-safe sequential employee code generation trigger
CREATE OR REPLACE FUNCTION public.generate_employee_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.employee_code IS NULL OR NEW.employee_code = '' THEN
        NEW.employee_code := 'EMP-A-' || lpad(nextval('public.seq_branch_a_employee_code')::text, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_generate_employee_code
    BEFORE INSERT ON public.employees
    FOR EACH ROW EXECUTE FUNCTION public.generate_employee_code();

-- Hard-delete defense trigger on employees
CREATE OR REPLACE FUNCTION public.prevent_hard_delete_employees()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Physical DELETE on employees is prohibited. Use soft-delete (set is_deleted = TRUE).';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_hard_delete_employees
    BEFORE DELETE ON public.employees
    FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete_employees();

-- Attendance check-in validation and status classification trigger
CREATE OR REPLACE FUNCTION public.validate_attendance_check_in()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_schedule_date DATE;
    v_shift_start TIME;
    v_grace_mins INT;
    v_shift_start_ts TIMESTAMPTZ;
    v_threshold_ts TIMESTAMPTZ;
BEGIN
    -- Disallow retrospective or future timestamps beyond 5 minutes
    IF NEW.check_in_time > now() + INTERVAL '5 minutes' THEN
        RAISE EXCEPTION 'Check-in timestamp cannot be set in the future.';
    END IF;

    -- Lookup schedule date, shift start time and branch grace period
    SELECT es.schedule_date, s.start_time, c.attendance_grace_period_mins
    INTO v_schedule_date, v_shift_start, v_grace_mins
    FROM public.employee_schedules es
    JOIN public.shifts s ON s.id = es.shift_id
    CROSS JOIN public.branch_config c
    WHERE es.id = NEW.schedule_id;

    IF v_shift_start IS NOT NULL AND v_schedule_date IS NOT NULL THEN
        -- Construct exact scheduled start timestamp in local Asia/Jakarta timezone
        v_shift_start_ts := (v_schedule_date + v_shift_start) AT TIME ZONE 'Asia/Jakarta';
        v_threshold_ts := v_shift_start_ts + (COALESCE(v_grace_mins, 15) * INTERVAL '1 minute');

        IF NEW.check_in_time > v_threshold_ts THEN
            NEW.status := 'LATE';
        ELSE
            NEW.status := 'ON_TIME';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_attendance_check_in
    BEFORE INSERT ON public.attendance
    FOR EACH ROW EXECUTE FUNCTION public.validate_attendance_check_in();

-- Leave overlap defense trigger
CREATE OR REPLACE FUNCTION public.prevent_overlapping_leave()
RETURNS TRIGGER AS $$
DECLARE
    v_overlap_count INT;
BEGIN
    IF NEW.status = 'APPROVED' THEN
        SELECT COUNT(*) INTO v_overlap_count
        FROM public.leave_requests
        WHERE employee_id = NEW.employee_id
          AND id != NEW.id
          AND status = 'APPROVED'
          AND daterange(start_date, end_date, '[]') && daterange(NEW.start_date, NEW.end_date, '[]');

        IF v_overlap_count > 0 THEN
            RAISE EXCEPTION 'Employee already has an approved leave request overlapping this date range.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_overlapping_leave
    BEFORE INSERT OR UPDATE ON public.leave_requests
    FOR EACH ROW EXECUTE FUNCTION public.prevent_overlapping_leave();

-- Local audit trail logging trigger function
CREATE OR REPLACE FUNCTION public.record_branch_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id UUID;
    v_actor_email VARCHAR(255);
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
        v_actor_id, v_actor_email, '00000000-0000-0000-0000-000000000001'::uuid, v_action,
        TG_TABLE_NAME, v_entity_id, v_old_values, v_new_values,
        now()
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

-- Attach audit triggers to operational tables
CREATE TRIGGER trg_audit_employees
    AFTER INSERT OR UPDATE ON public.employees
    FOR EACH ROW EXECUTE FUNCTION public.record_branch_audit_log();

CREATE TRIGGER trg_audit_attendance
    AFTER INSERT OR UPDATE ON public.attendance
    FOR EACH ROW EXECUTE FUNCTION public.record_branch_audit_log();

CREATE TRIGGER trg_audit_leave_requests
    AFTER INSERT OR UPDATE ON public.leave_requests
    FOR EACH ROW EXECUTE FUNCTION public.record_branch_audit_log();

CREATE TRIGGER trg_audit_employee_schedules
    AFTER INSERT OR UPDATE OR DELETE ON public.employee_schedules
    FOR EACH ROW EXECUTE FUNCTION public.record_branch_audit_log();

-- ============================================================================
-- 4. TRANSACTIONAL OUTBOX EVENT DISPATCH TRIGGERS
-- ============================================================================

-- Outbox publisher for Employee operational mutations
CREATE OR REPLACE FUNCTION public.emit_employee_outbox_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_dept_name VARCHAR(100);
    v_pos_title VARCHAR(100);
    v_event_type VARCHAR(100);
    v_payload JSONB;
BEGIN
    SELECT name INTO v_dept_name FROM public.departments WHERE id = NEW.department_id;
    SELECT title INTO v_pos_title FROM public.positions WHERE id = NEW.position_id;

    -- Increment aggregate version on update
    IF TG_OP = 'UPDATE' THEN
        NEW.version := OLD.version + 1;
    END IF;

    IF NEW.is_deleted = TRUE THEN
        v_event_type := 'EMPLOYEE_DEACTIVATED';
    ELSE
        v_event_type := 'EMPLOYEE_UPSERTED';
    END IF;

    v_payload := jsonb_build_object(
        'id', NEW.id,
        'branch_code', 'BRANCH-A',
        'employee_code', NEW.employee_code,
        'full_name', NEW.full_name,
        'email', NEW.email,
        'department_name', v_dept_name,
        'position_title', v_pos_title,
        'employment_status', NEW.employment_status,
        'join_date', NEW.join_date,
        'is_active', NEW.is_active AND NOT NEW.is_deleted,
        'version', NEW.version
    );

    INSERT INTO public.sync_outbox (
        aggregate_type, aggregate_id, aggregate_version,
        event_type, payload, status
    ) VALUES (
        'EMPLOYEE', NEW.id, NEW.version,
        v_event_type, v_payload, 'PENDING'
    );

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_employee_outbox_sync
    BEFORE INSERT OR UPDATE ON public.employees
    FOR EACH ROW EXECUTE FUNCTION public.emit_employee_outbox_event();

-- Core rollup calculation procedure for Daily Attendance Summary
CREATE OR REPLACE FUNCTION public.recalculate_attendance_summary(p_date DATE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_total INT;
    v_present INT;
    v_late INT;
    v_absent INT;
    v_leave INT;
    v_rollup_version BIGINT;
    v_payload JSONB;
BEGIN
    IF p_date IS NULL THEN
        RETURN;
    END IF;

    -- Total active schedules for that date
    SELECT COUNT(*) INTO v_total
    FROM public.employee_schedules
    WHERE schedule_date = p_date AND status != 'CANCELLED';

    -- Present on-time: All non-late check-ins (ON_TIME, EARLY_DEPARTURE, OVERTIME, INCOMPLETE)
    SELECT COUNT(*) INTO v_present
    FROM public.attendance
    WHERE attendance_date = p_date
      AND status IN ('ON_TIME', 'EARLY_DEPARTURE', 'OVERTIME', 'INCOMPLETE');

    -- Late check-ins
    SELECT COUNT(*) INTO v_late
    FROM public.attendance
    WHERE attendance_date = p_date AND status = 'LATE';

    -- Employees on approved leave on that date
    SELECT COUNT(DISTINCT employee_id) INTO v_leave
    FROM public.leave_requests
    WHERE status = 'APPROVED'
      AND p_date BETWEEN start_date AND end_date;

    -- Absent: Scheduled but no attendance record exists
    SELECT COUNT(*) INTO v_absent
    FROM public.employee_schedules es
    WHERE es.schedule_date = p_date
      AND es.status = 'SCHEDULED'
      AND NOT EXISTS (
          SELECT 1 FROM public.attendance a WHERE a.schedule_id = es.id
      )
      AND NOT EXISTS (
          SELECT 1 FROM public.leave_requests lr
          WHERE lr.employee_id = es.employee_id
            AND lr.status = 'APPROVED'
            AND p_date BETWEEN lr.start_date AND lr.end_date
      );

    -- Ensure non-negative bounds
    v_total := GREATEST(v_total, v_present + v_late + v_leave + v_absent);

    -- Generate monotonic rollup sequence timestamp from epoch milliseconds
    v_rollup_version := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint;

    v_payload := jsonb_build_object(
        'branch_code', 'BRANCH-A',
        'summary_date', p_date,
        'total_employees', v_total,
        'present_count', v_present,
        'late_count', v_late,
        'absent_count', v_absent,
        'leave_count', v_leave,
        'source_version', v_rollup_version
    );

    INSERT INTO public.sync_outbox (
        aggregate_type, aggregate_id, aggregate_version,
        event_type, payload, status
    ) VALUES (
        'ATTENDANCE_SUMMARY', '00000000-0000-0000-0000-000000000001'::uuid, v_rollup_version,
        'ATTENDANCE_SUMMARY_RECORDED', v_payload, 'PENDING'
    );
END;
$$;

-- Trigger handler for attendance changes
CREATE OR REPLACE FUNCTION public.emit_attendance_summary_outbox_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.recalculate_attendance_summary(OLD.attendance_date);
        RETURN OLD;
    ELSE
        PERFORM public.recalculate_attendance_summary(NEW.attendance_date);
        IF TG_OP = 'UPDATE' AND OLD.attendance_date != NEW.attendance_date THEN
            PERFORM public.recalculate_attendance_summary(OLD.attendance_date);
        END IF;
        RETURN NEW;
    END IF;
END;
$$;

CREATE TRIGGER trg_attendance_summary_rollup
    AFTER INSERT OR UPDATE ON public.attendance
    FOR EACH ROW EXECUTE FUNCTION public.emit_attendance_summary_outbox_event();

-- Trigger handler for schedule changes affecting daily attendance summary
CREATE OR REPLACE FUNCTION public.emit_schedule_summary_outbox_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.recalculate_attendance_summary(OLD.schedule_date);
        RETURN OLD;
    ELSE
        PERFORM public.recalculate_attendance_summary(NEW.schedule_date);
        IF TG_OP = 'UPDATE' AND OLD.schedule_date != NEW.schedule_date THEN
            PERFORM public.recalculate_attendance_summary(OLD.schedule_date);
        END IF;
        RETURN NEW;
    END IF;
END;
$$;

CREATE TRIGGER trg_schedule_summary_rollup
    AFTER INSERT OR UPDATE OR DELETE ON public.employee_schedules
    FOR EACH ROW EXECUTE FUNCTION public.emit_schedule_summary_outbox_event();

-- Trigger handler for leave request status changes affecting daily attendance summary
CREATE OR REPLACE FUNCTION public.emit_leave_summary_outbox_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_date DATE;
    v_start DATE;
    v_end DATE;
BEGIN
    IF (TG_OP = 'INSERT' AND NEW.status = 'APPROVED') OR
       (TG_OP = 'UPDATE' AND (NEW.status = 'APPROVED' OR OLD.status = 'APPROVED')) OR
       (TG_OP = 'DELETE' AND OLD.status = 'APPROVED') THEN

        v_start := COALESCE(NEW.start_date, OLD.start_date);
        v_end := COALESCE(NEW.end_date, OLD.end_date);

        FOR v_date IN SELECT generate_series(v_start, v_end, INTERVAL '1 day')::date LOOP
            PERFORM public.recalculate_attendance_summary(v_date);
        END LOOP;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_leave_summary_rollup
    AFTER INSERT OR UPDATE ON public.leave_requests
    FOR EACH ROW EXECUTE FUNCTION public.emit_leave_summary_outbox_event();

-- ============================================================================
-- 5. WORKER LEASE & OUTBOX CONCURRENCY CONTROL FUNCTIONS
-- ============================================================================

-- Claim batch of pending outbox events with optimistic lease
CREATE OR REPLACE FUNCTION public.claim_outbox_batch(
    p_worker_id VARCHAR(100),
    p_batch_size INT DEFAULT 50
)
RETURNS TABLE (
    event_id UUID,
    aggregate_type VARCHAR(100),
    aggregate_id UUID,
    aggregate_version BIGINT,
    event_type VARCHAR(100),
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
        FROM public.sync_outbox
        WHERE (status = 'PENDING' AND (next_retry_at IS NULL OR next_retry_at <= now()))
           OR (status = 'PROCESSING' AND locked_at < now() - INTERVAL '5 minutes') -- Expired lease recovery
        ORDER BY created_at ASC
        LIMIT p_batch_size
        FOR UPDATE SKIP LOCKED
    ),
    claimed AS (
        UPDATE public.sync_outbox
        SET status = 'PROCESSING',
            locked_by = p_worker_id,
            locked_at = now()
        WHERE id IN (SELECT id FROM eligible)
        RETURNING public.sync_outbox.event_id, public.sync_outbox.aggregate_type,
                  public.sync_outbox.aggregate_id, public.sync_outbox.aggregate_version,
                  public.sync_outbox.event_type, public.sync_outbox.payload
    )
    SELECT * FROM claimed;
END;
$$;

-- Mark outbox event as durably published after Central confirmation
CREATE OR REPLACE FUNCTION public.mark_outbox_published(
    p_event_id UUID,
    p_worker_id VARCHAR(100)
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_rows INT;
BEGIN
    UPDATE public.sync_outbox
    SET status = 'PUBLISHED',
        published_at = now(),
        locked_by = NULL,
        locked_at = NULL,
        last_error = NULL
    WHERE event_id = p_event_id
      AND locked_by = p_worker_id;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows > 0;
END;
$$;

-- Mark outbox event as failed with exponential backoff
CREATE OR REPLACE FUNCTION public.mark_outbox_failed(
    p_event_id UUID,
    p_worker_id VARCHAR(100),
    p_error_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.sync_outbox
    SET status = 'FAILED',
        retry_count = retry_count + 1,
        next_retry_at = now() + (POWER(2, LEAST(retry_count + 1, 6)) * INTERVAL '1 second'),
        last_error = p_error_message,
        locked_by = NULL,
        locked_at = NULL
    WHERE event_id = p_event_id
      AND locked_by = p_worker_id;
END;
$$;

-- ============================================================================
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
-- IMPORTANT ARCHITECTURAL NOTE:
-- Branch A is an independent PostgreSQL cluster that does not directly trust
-- Central Auth JWTs. All user operations access Branch A via the Backend Gateway.
-- 1. When the Backend connects using service_role, PostgreSQL BYPASSES RLS.
--    Therefore, the Backend Gateway MUST explicitly enforce user-level authorization!
-- 2. When the Backend sets 'request.jwt.claims' in the PostgreSQL session or uses
--    scoped connections, the RLS policies below provide strict defense-in-depth.
-- ============================================================================

ALTER TABLE public.branch_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- RLS Policies: branch_config
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "branch_config_read" ON public.branch_config;
CREATE POLICY "branch_config_read" ON public.branch_config
    FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "branch_config_update" ON public.branch_config;
CREATE POLICY "branch_config_update" ON public.branch_config
    FOR UPDATE TO authenticated
    USING (public.get_auth_role() IN ('SUPERADMIN', 'BRANCH_MANAGER'));

-- ----------------------------------------------------------------------------
-- RLS Policies: departments & positions
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "departments_read" ON public.departments;
CREATE POLICY "departments_read" ON public.departments
    FOR SELECT TO authenticated USING (is_active = TRUE OR public.get_auth_role() IN ('BRANCH_HR', 'BRANCH_MANAGER'));

DROP POLICY IF EXISTS "departments_manage" ON public.departments;
CREATE POLICY "departments_manage" ON public.departments
    FOR ALL TO authenticated
    USING (public.get_auth_role() IN ('BRANCH_HR', 'BRANCH_MANAGER'))
    WITH CHECK (public.get_auth_role() IN ('BRANCH_HR', 'BRANCH_MANAGER'));

DROP POLICY IF EXISTS "positions_read" ON public.positions;
CREATE POLICY "positions_read" ON public.positions
    FOR SELECT TO authenticated USING (is_active = TRUE OR public.get_auth_role() IN ('BRANCH_HR', 'BRANCH_MANAGER'));

DROP POLICY IF EXISTS "positions_manage" ON public.positions;
CREATE POLICY "positions_manage" ON public.positions
    FOR ALL TO authenticated
    USING (public.get_auth_role() = 'BRANCH_HR')
    WITH CHECK (public.get_auth_role() = 'BRANCH_HR');

-- ----------------------------------------------------------------------------
-- RLS Policies: employees
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "employees_select" ON public.employees;
CREATE POLICY "employees_select" ON public.employees
    FOR SELECT TO authenticated
    USING (
        (user_auth_id = auth.uid() AND is_deleted = FALSE) OR
        public.get_auth_role() IN ('BRANCH_HR', 'BRANCH_MANAGER', 'SUPERADMIN')
    );

DROP POLICY IF EXISTS "employees_hr_manage" ON public.employees;
CREATE POLICY "employees_hr_manage" ON public.employees
    FOR ALL TO authenticated
    USING (public.get_auth_role() = 'BRANCH_HR')
    WITH CHECK (public.get_auth_role() = 'BRANCH_HR');

-- ----------------------------------------------------------------------------
-- RLS Policies: shifts
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "shifts_read" ON public.shifts;
CREATE POLICY "shifts_read" ON public.shifts
    FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "shifts_manage" ON public.shifts;
CREATE POLICY "shifts_manage" ON public.shifts
    FOR ALL TO authenticated
    USING (public.get_auth_role() IN ('BRANCH_HR', 'BRANCH_MANAGER'))
    WITH CHECK (public.get_auth_role() IN ('BRANCH_HR', 'BRANCH_MANAGER'));

-- ----------------------------------------------------------------------------
-- RLS Policies: employee_schedules
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "schedules_select" ON public.employee_schedules;
CREATE POLICY "schedules_select" ON public.employee_schedules
    FOR SELECT TO authenticated
    USING (
        employee_id = public.get_current_employee_id() OR
        public.get_auth_role() IN ('BRANCH_HR', 'BRANCH_MANAGER', 'SUPERADMIN')
    );

DROP POLICY IF EXISTS "schedules_manage" ON public.employee_schedules;
CREATE POLICY "schedules_manage" ON public.employee_schedules
    FOR ALL TO authenticated
    USING (public.get_auth_role() IN ('BRANCH_HR', 'BRANCH_MANAGER'))
    WITH CHECK (public.get_auth_role() IN ('BRANCH_HR', 'BRANCH_MANAGER'));

-- ----------------------------------------------------------------------------
-- RLS Policies: attendance
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "attendance_select" ON public.attendance;
CREATE POLICY "attendance_select" ON public.attendance
    FOR SELECT TO authenticated
    USING (
        employee_id = public.get_current_employee_id() OR
        public.get_auth_role() IN ('BRANCH_HR', 'BRANCH_MANAGER', 'SUPERADMIN')
    );

DROP POLICY IF EXISTS "attendance_self_check_in" ON public.attendance;
CREATE POLICY "attendance_self_check_in" ON public.attendance
    FOR INSERT TO authenticated
    WITH CHECK (
        employee_id = public.get_current_employee_id() AND
        schedule_id IN (
            SELECT id FROM public.employee_schedules
            WHERE employee_id = public.get_current_employee_id()
              AND status != 'CANCELLED'
        )
    );

DROP POLICY IF EXISTS "attendance_self_check_out" ON public.attendance;
CREATE POLICY "attendance_self_check_out" ON public.attendance
    FOR UPDATE TO authenticated
    USING (
        employee_id = public.get_current_employee_id() AND
        check_out_time IS NULL
    )
    WITH CHECK (
        check_out_time IS NOT NULL AND
        check_out_time > check_in_time
    );

DROP POLICY IF EXISTS "attendance_manager_verify" ON public.attendance;
CREATE POLICY "attendance_manager_verify" ON public.attendance
    FOR UPDATE TO authenticated
    USING (public.get_auth_role() IN ('BRANCH_MANAGER', 'SUPERADMIN'));

-- ----------------------------------------------------------------------------
-- RLS Policies: leave_requests
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "leave_select" ON public.leave_requests;
CREATE POLICY "leave_select" ON public.leave_requests
    FOR SELECT TO authenticated
    USING (
        employee_id = public.get_current_employee_id() OR
        public.get_auth_role() IN ('BRANCH_HR', 'BRANCH_MANAGER', 'SUPERADMIN')
    );

DROP POLICY IF EXISTS "leave_self_submit" ON public.leave_requests;
CREATE POLICY "leave_self_submit" ON public.leave_requests
    FOR INSERT TO authenticated
    WITH CHECK (
        employee_id = public.get_current_employee_id() AND
        status = 'PENDING'
    );

DROP POLICY IF EXISTS "leave_manager_decide" ON public.leave_requests;
CREATE POLICY "leave_manager_decide" ON public.leave_requests
    FOR UPDATE TO authenticated
    USING (public.get_auth_role() IN ('BRANCH_MANAGER', 'SUPERADMIN'))
    WITH CHECK (status IN ('APPROVED', 'REJECTED'));

-- ----------------------------------------------------------------------------
-- RLS Policies: audit_logs
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "audit_logs_select" ON public.audit_logs;
CREATE POLICY "audit_logs_select" ON public.audit_logs
    FOR SELECT TO authenticated
    USING (public.get_auth_role() IN ('BRANCH_MANAGER', 'SUPERADMIN'));

-- ============================================================================
-- 7. DATABASE GRANTS & RESTRICTIONS
-- ============================================================================

-- Grant appropriate usage to authenticated users
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT SELECT ON public.branch_config TO authenticated;
GRANT SELECT ON public.departments TO authenticated;
GRANT SELECT ON public.positions TO authenticated;
GRANT SELECT ON public.employees TO authenticated;
GRANT SELECT ON public.shifts TO authenticated;
GRANT SELECT ON public.employee_schedules TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.attendance TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.leave_requests TO authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;

-- Service role grants for backend workers
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Revoke all public / anonymous permissions on outbox and sensitive operations
REVOKE ALL ON public.sync_outbox FROM anon, authenticated;
REVOKE DELETE ON public.employees FROM anon, authenticated;
REVOKE DELETE ON public.attendance FROM anon, authenticated;

-- ============================================================================
-- END OF BRANCH A DATABASE MIGRATION SCRIPT
-- ============================================================================
