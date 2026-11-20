-- ============================================================================
-- NEXUS HR — PHASE 3.12A: REMEDIATION SPECIFICATION V2.6
-- ============================================================================
-- STATUS: SPECIFICATION ONLY — DO NOT EXECUTE WITHOUT OWNER AUTHORIZATION
-- MODE:   Prepared from Phase 3.12A Read-Only Security Architecture Review
--
-- TARGET NODES:
--   PART 1 -> Branch A (nexus-branch-a | Ref: uneycmbqqpkifwhwzbes | PG 17.11)
--   PART 2 -> Central  (nexus-central  | Ref: wcmevigbqsmzsdqidjel | PG 17.11)
--
-- LEGACY PROJECTS (bolt, cbt, nusantara): STRICTLY OFF-LIMITS
--
-- PREREQUISITE BEFORE APPLYING PART 1:
--   1. Owner decision confirming Gateway-RPC-only leave updates.
--   2. Out-of-band provisioning of a cryptographically random 256-bit HMAC key
--      into nexus_internal.gateway_signing_keys (NEVER hardcode secrets in SQL).
-- ============================================================================


-- ############################################################################
-- PART 1: BRANCH A REMEDIATION (TARGET: nexus-branch-a / uneycmbqqpkifwhwzbes)
-- ############################################################################

-- ----------------------------------------------------------------------------
-- 1.1 Precondition Guards (Fail-Fast Before Any Schema Change)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_branch_cfg_count INT;
    v_emp_code_len INT;
    v_has_pgcrypto BOOLEAN;
BEGIN
    SELECT COUNT(*) INTO v_branch_cfg_count
    FROM public.branch_config
    WHERE id = '00000000-0000-0000-0000-000000000001'::uuid
      AND branch_code = 'BRANCH-A';

    IF v_branch_cfg_count <> 1 THEN
        RAISE EXCEPTION 'Precondition failed: Expected canonical BRANCH-A row in public.branch_config.';
    END IF;

    SELECT character_maximum_length INTO v_emp_code_len
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employees'
      AND column_name = 'employee_code';

    IF COALESCE(v_emp_code_len, 0) < 50 THEN
        RAISE EXCEPTION 'Precondition failed: public.employees.employee_code length (%) is unexpected.', v_emp_code_len;
    END IF;

    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') INTO v_has_pgcrypto;
    IF NOT v_has_pgcrypto THEN
        RAISE EXCEPTION 'Precondition failed: pgcrypto extension is required.';
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1.2 Private Internal Security Schema (Inaccessible to anon, authenticated, service_role)
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS nexus_internal AUTHORIZATION postgres;

REVOKE ALL ON SCHEMA nexus_internal FROM PUBLIC, anon, authenticated, service_role;

-- Stores HMAC signing keys for verifying Gateway actor assertions.
-- NOTE: service_role has rolsuper=false and NO access to nexus_internal,
-- isolating Gateway signing trust from Sync Worker service_role credentials.
CREATE TABLE IF NOT EXISTS nexus_internal.gateway_signing_keys (
    key_id VARCHAR(64) PRIMARY KEY,
    hmac_secret TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    rotated_at TIMESTAMPTZ
);

REVOKE ALL ON TABLE nexus_internal.gateway_signing_keys FROM PUBLIC, anon, authenticated, service_role;

-- Single-use nonce ledger preventing credential replay within short TTL window.
CREATE TABLE IF NOT EXISTS nexus_internal.used_actor_nonces (
    nonce UUID PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_used_actor_nonces_expires
    ON nexus_internal.used_actor_nonces (expires_at);

REVOKE ALL ON TABLE nexus_internal.used_actor_nonces FROM PUBLIC, anon, authenticated, service_role;

-- Unforgeable per-transaction actor context populated ONLY after HMAC + DB checks.
-- Replaces writable custom session GUCs (SET LOCAL).
CREATE TABLE IF NOT EXISTS nexus_internal.tx_actor_context (
    txid XID8 PRIMARY KEY,
    actor_user_id UUID NOT NULL,
    actor_email VARCHAR(255) NOT NULL,
    actor_role VARCHAR(50) NOT NULL,
    branch_id UUID,
    employee_id UUID,
    action_scope VARCHAR(64) NOT NULL,
    operation_mode VARCHAR(32) NOT NULL,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE nexus_internal.tx_actor_context FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 1.3 Cryptographic Actor Verification Function (Internal Only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nexus_internal.verify_gateway_actor(
    p_action_scope TEXT,
    p_target_id UUID,
    p_operation_mode TEXT,
    p_actor_user_id UUID,
    p_actor_email TEXT,
    p_actor_role TEXT,
    p_branch_id UUID,
    p_employee_id UUID,
    p_exp BIGINT,
    p_nonce UUID,
    p_actor_sig TEXT
)
RETURNS nexus_internal.tx_actor_context
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nexus_internal, public, extensions, pg_temp
AS $$
DECLARE
    v_now_epoch BIGINT;
    v_secret TEXT;
    v_canonical TEXT;
    v_expected_hex TEXT;
    v_nonce_claimed UUID;
    v_branch_cfg_id UUID;
    v_emp_active BOOLEAN;
    v_emp_deleted BOOLEAN;
    v_emp_user_id UUID;
    v_ctx nexus_internal.tx_actor_context;
BEGIN
    -- 1. Caller transport boundary check
    IF session_user = 'authenticator' THEN
        IF NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' IS DISTINCT FROM 'service_role' THEN
            RAISE EXCEPTION '42501: Gateway RPC requires authenticated service_role transport.';
        END IF;
    ELSIF session_user NOT IN ('postgres') THEN
        RAISE EXCEPTION '42501: Unauthorized PostgreSQL session caller (%).', session_user;
    END IF;

    -- 2. Required non-null parameter checks (Fail Closed)
    IF p_action_scope IS NULL OR btrim(p_action_scope) = '' THEN
        RAISE EXCEPTION 'Invalid actor assertion: action_scope is required.';
    END IF;
    IF p_target_id IS NULL THEN
        RAISE EXCEPTION 'Invalid actor assertion: target_id is required.';
    END IF;
    IF p_actor_user_id IS NULL THEN
        RAISE EXCEPTION '42501: Missing actor_user_id (fails closed).';
    END IF;
    IF p_actor_email IS NULL OR btrim(p_actor_email) = '' THEN
        RAISE EXCEPTION '42501: Missing actor_email (fails closed).';
    END IF;
    IF p_actor_role IS NULL OR p_actor_role NOT IN ('SUPERADMIN', 'BRANCH_MANAGER', 'BRANCH_HR', 'EMPLOYEE') THEN
        RAISE EXCEPTION '42501: Invalid or NULL actor_role (fails closed).';
    END IF;
    IF p_exp IS NULL OR p_nonce IS NULL OR p_actor_sig IS NULL OR length(p_actor_sig) <> 64 THEN
        RAISE EXCEPTION '42501: Malformed cryptographic actor envelope.';
    END IF;

    -- 3. Expiry and max TTL window check (<= 120 seconds)
    v_now_epoch := floor(extract(epoch FROM now()))::bigint;
    IF p_exp < v_now_epoch THEN
        RAISE EXCEPTION '42501: Expired Gateway actor credential.';
    END IF;
    IF (p_exp - v_now_epoch) > 120 THEN
        RAISE EXCEPTION '42501: Gateway actor credential TTL exceeds 120s maximum.';
    END IF;

    -- 4. Load active HMAC key from protected internal table
    SELECT hmac_secret INTO v_secret
    FROM nexus_internal.gateway_signing_keys
    WHERE is_active = TRUE
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_secret IS NULL OR length(v_secret) < 32 THEN
        RAISE EXCEPTION '55000: Gateway HMAC signing key is not provisioned in nexus_internal.gateway_signing_keys.';
    END IF;

    -- 5. Compute and compare HMAC-SHA256 using SHA-256 digest equality
    v_canonical := concat_ws('|',
        p_action_scope,
        p_target_id::text,
        p_operation_mode,
        p_actor_user_id::text,
        lower(btrim(p_actor_email)),
        p_actor_role,
        COALESCE(p_branch_id::text, ''),
        COALESCE(p_employee_id::text, ''),
        p_exp::text,
        p_nonce::text
    );

    v_expected_hex := encode(
        extensions.hmac(convert_to(v_canonical, 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256'),
        'hex'
    );

    IF encode(extensions.digest(convert_to(v_expected_hex, 'UTF8'), 'sha256'), 'hex')
       IS DISTINCT FROM
       encode(extensions.digest(convert_to(lower(p_actor_sig), 'UTF8'), 'sha256'), 'hex') THEN
        RAISE EXCEPTION '42501: Forged or invalid Gateway actor signature.';
    END IF;

    -- 6. Opportunistic prune of expired nonces + atomic anti-replay nonce claim
    DELETE FROM nexus_internal.used_actor_nonces
    WHERE expires_at < now() - INTERVAL '5 minutes';

    INSERT INTO nexus_internal.used_actor_nonces (nonce, expires_at)
    VALUES (p_nonce, to_timestamp(p_exp))
    ON CONFLICT (nonce) DO NOTHING
    RETURNING nonce INTO v_nonce_claimed;

    IF v_nonce_claimed IS NULL THEN
        RAISE EXCEPTION '42501: Replayed Gateway actor credential (nonce already consumed).';
    END IF;

    -- 7. Live database cross-verification (never trust claims without DB state match)
    SELECT id INTO v_branch_cfg_id FROM public.branch_config LIMIT 1;

    IF p_actor_role IN ('BRANCH_MANAGER', 'BRANCH_HR', 'EMPLOYEE') THEN
        IF p_branch_id IS DISTINCT FROM v_branch_cfg_id THEN
            RAISE EXCEPTION '42501: Invalid or mismatched branch membership for role %.', p_actor_role;
        END IF;

        IF p_employee_id IS NULL THEN
            RAISE EXCEPTION '42501: Active employee identity is required for role %.', p_actor_role;
        END IF;

        SELECT user_auth_id, is_active, is_deleted
        INTO v_emp_user_id, v_emp_active, v_emp_deleted
        FROM public.employees
        WHERE id = p_employee_id;

        IF NOT FOUND OR v_emp_user_id IS DISTINCT FROM p_actor_user_id
           OR v_emp_active IS NOT TRUE OR v_emp_deleted IS NOT FALSE THEN
            RAISE EXCEPTION '42501: Employee identity (%) not found, mismatched, inactive, or deleted.', p_employee_id;
        END IF;
    ELSIF p_actor_role = 'SUPERADMIN' THEN
        IF p_employee_id IS NOT NULL THEN
            SELECT user_auth_id, is_active, is_deleted
            INTO v_emp_user_id, v_emp_active, v_emp_deleted
            FROM public.employees
            WHERE id = p_employee_id;

            IF NOT FOUND OR v_emp_user_id IS DISTINCT FROM p_actor_user_id
               OR v_emp_active IS NOT TRUE OR v_emp_deleted IS NOT FALSE THEN
                RAISE EXCEPTION '42501: Supplied SUPERADMIN employee_id (%) does not match active employee record.', p_employee_id;
            END IF;
        END IF;
    END IF;

    -- 8. Cleanup stale orphaned context rows and bind verified actor to pg_current_xact_id()
    DELETE FROM nexus_internal.tx_actor_context
    WHERE verified_at < now() - INTERVAL '5 minutes';

    INSERT INTO nexus_internal.tx_actor_context (
        txid, actor_user_id, actor_email, actor_role, branch_id,
        employee_id, action_scope, operation_mode, verified_at
    ) VALUES (
        pg_current_xact_id(), p_actor_user_id, lower(btrim(p_actor_email)), p_actor_role,
        p_branch_id, p_employee_id, p_action_scope, p_operation_mode, now()
    )
    ON CONFLICT (txid) DO UPDATE SET
        actor_user_id  = EXCLUDED.actor_user_id,
        actor_email    = EXCLUDED.actor_email,
        actor_role     = EXCLUDED.actor_role,
        branch_id      = EXCLUDED.branch_id,
        employee_id    = EXCLUDED.employee_id,
        action_scope   = EXCLUDED.action_scope,
        operation_mode = EXCLUDED.operation_mode,
        verified_at    = EXCLUDED.verified_at
    RETURNING * INTO v_ctx;

    RETURN v_ctx;
END;
$$;

ALTER FUNCTION nexus_internal.verify_gateway_actor(
    TEXT, UUID, TEXT, UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
) OWNER TO postgres;

REVOKE ALL ON FUNCTION nexus_internal.verify_gateway_actor(
    TEXT, UUID, TEXT, UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 1.4 Fail-Closed Auth Helpers & Trigger-Safe Audit Logger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role TEXT;
BEGIN
    -- Fail closed: ONLY extract role from PostgREST-verified authenticated JWT claims.
    IF session_user = 'authenticator' AND current_setting('role', true) = 'authenticated' THEN
        v_role := COALESCE(
            NULLIF(current_setting('request.jwt.claims', true), '')::jsonb -> 'app_metadata' ->> 'user_role',
            auth.jwt() -> 'app_metadata' ->> 'user_role'
        );
        IF v_role IN ('SUPERADMIN', 'CENTRAL_HR', 'BRANCH_MANAGER', 'BRANCH_HR', 'EMPLOYEE') THEN
            RETURN v_role;
        END IF;
    END IF;
    RETURN NULL;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$;

ALTER FUNCTION public.get_auth_role() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.get_current_employee_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_emp_id UUID;
BEGIN
    IF session_user = 'authenticator' AND current_setting('role', true) = 'authenticated' THEN
        v_uid := auth.uid();
        IF v_uid IS NULL THEN
            RETURN NULL;
        END IF;
        SELECT id INTO v_emp_id
        FROM public.employees
        WHERE user_auth_id = v_uid
          AND is_active = TRUE
          AND is_deleted = FALSE
        LIMIT 1;
        RETURN v_emp_id;
    END IF;
    RETURN NULL;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$;

ALTER FUNCTION public.get_current_employee_id() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.record_branch_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nexus_internal, public, auth, pg_temp
AS $$
DECLARE
    v_ctx nexus_internal.tx_actor_context%ROWTYPE;
    v_has_ctx BOOLEAN := FALSE;
    v_actor_id UUID;
    v_actor_email VARCHAR(255);
    v_action VARCHAR(100);
    v_old_values JSONB := NULL;
    v_new_values JSONB := NULL;
    v_entity_id UUID := NULL;
BEGIN
    -- Priority 1: Cryptographically verified Gateway transaction actor context
    SELECT * INTO v_ctx
    FROM nexus_internal.tx_actor_context
    WHERE txid = pg_current_xact_id();

    IF FOUND THEN
        v_has_ctx := TRUE;
        v_actor_id := v_ctx.actor_user_id;
        v_actor_email := v_ctx.actor_email;
    ELSIF session_user = 'authenticator' AND current_setting('role', true) = 'authenticated' THEN
        -- Priority 2: Direct authenticated PostgREST JWT only (never writable GUCs)
        v_actor_id := auth.uid();
        v_actor_email := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
    ELSE
        v_actor_id := NULL;
        v_actor_email := NULL;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_action := TG_TABLE_NAME || '_CREATED';
        v_new_values := to_jsonb(NEW);
        v_entity_id := NEW.id;
    ELSIF TG_OP = 'UPDATE' THEN
        IF TG_TABLE_NAME = 'leave_requests' AND v_has_ctx THEN
            IF v_ctx.actor_role = 'BRANCH_MANAGER' THEN
                v_action := 'leave_requests_MANAGER_DECIDED';
            ELSIF v_ctx.actor_role = 'SUPERADMIN' AND v_ctx.operation_mode = 'DECISION' THEN
                v_action := 'leave_requests_SUPERADMIN_DECIDED';
            ELSIF v_ctx.actor_role = 'SUPERADMIN' AND v_ctx.operation_mode = 'CORRECTION' THEN
                v_action := 'leave_requests_SUPERADMIN_CORRECTED';
            ELSE
                v_action := 'leave_requests_UPDATED';
            END IF;
        ELSE
            v_action := TG_TABLE_NAME || '_UPDATED';
        END IF;
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

ALTER FUNCTION public.record_branch_audit_log() OWNER TO postgres;

-- ----------------------------------------------------------------------------
-- 1.5 Fail-Closed Leave Request Decision Integrity Trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_leave_decision_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nexus_internal, public, auth, pg_temp
AS $$
DECLARE
    v_ctx nexus_internal.tx_actor_context%ROWTYPE;
    v_actor_user_id UUID;
    v_actor_role TEXT;
    v_actor_emp_id UUID;
    v_op_mode TEXT;
    v_is_self_emp BOOLEAN;
BEGIN
    -- Resolve verified actor ONLY from unforgeable internal context or authenticated PostgREST JWT.
    -- Explicitly NEVER reads custom session GUCs (SET LOCAL).
    -- service_role direct DML without tx_actor_context fails closed!
    SELECT * INTO v_ctx
    FROM nexus_internal.tx_actor_context
    WHERE txid = pg_current_xact_id();

    IF FOUND THEN
        v_actor_user_id := v_ctx.actor_user_id;
        v_actor_role := v_ctx.actor_role;
        v_actor_emp_id := v_ctx.employee_id;
        v_op_mode := v_ctx.operation_mode;
    ELSIF session_user = 'authenticator' AND current_setting('role', true) = 'authenticated' THEN
        v_actor_user_id := auth.uid();
        v_actor_role := public.get_auth_role();
        v_actor_emp_id := public.get_current_employee_id();
        v_op_mode := 'DECISION';
    ELSE
        RAISE EXCEPTION '42501: Direct leave_requests UPDATE without verified Gateway actor context is prohibited.';
    END IF;

    IF v_actor_user_id IS NULL OR v_actor_role IS NULL THEN
        RAISE EXCEPTION '42501: Missing verified actor identity or role (fails closed).';
    END IF;

    -- PATH A: SUPERADMIN (Full authority over all leave fields & retroactive corrections)
    IF v_actor_role = 'SUPERADMIN' THEN
        IF v_op_mode = 'DECISION' AND NEW.status IN ('APPROVED', 'REJECTED') THEN
            NEW.approved_by := COALESCE(NEW.approved_by, v_actor_user_id);
            NEW.approved_at := COALESCE(NEW.approved_at, now());
        END IF;
        RETURN NEW;
    END IF;

    -- PATH B: BRANCH_MANAGER (Strict decision-only rules)
    IF v_actor_role = 'BRANCH_MANAGER' THEN
        IF v_actor_emp_id IS NULL THEN
            RAISE EXCEPTION '42501: BRANCH_MANAGER requires a verified active employee identity.';
        END IF;

        -- Only PENDING requests may be decided
        IF OLD.status IS DISTINCT FROM 'PENDING' THEN
            RAISE EXCEPTION '42501: BRANCH_MANAGER may only decide requests in PENDING status (current: %).', OLD.status;
        END IF;

        IF NEW.status NOT IN ('APPROVED', 'REJECTED') THEN
            RAISE EXCEPTION '22023: BRANCH_MANAGER decision status must be APPROVED or REJECTED.';
        END IF;

        -- Reject self-approval via both employee_id match and user_auth_id ownership check
        SELECT EXISTS (
            SELECT 1 FROM public.employees e
            WHERE e.id = OLD.employee_id
              AND e.user_auth_id = v_actor_user_id
        ) INTO v_is_self_emp;

        IF (OLD.employee_id IS NOT DISTINCT FROM v_actor_emp_id)
           OR (NEW.employee_id IS NOT DISTINCT FROM v_actor_emp_id)
           OR v_is_self_emp THEN
            RAISE EXCEPTION '42501: Self-approval by BRANCH_MANAGER is strictly prohibited.';
        END IF;

        -- Prevent altering any application/metadata fields (nullable-safe IS DISTINCT FROM)
        IF (NEW.id IS DISTINCT FROM OLD.id)
           OR (NEW.employee_id IS DISTINCT FROM OLD.employee_id)
           OR (NEW.leave_type IS DISTINCT FROM OLD.leave_type)
           OR (NEW.start_date IS DISTINCT FROM OLD.start_date)
           OR (NEW.end_date IS DISTINCT FROM OLD.end_date)
           OR (NEW.total_days IS DISTINCT FROM OLD.total_days)
           OR (NEW.reason IS DISTINCT FROM OLD.reason)
           OR (NEW.submitted_at IS DISTINCT FROM OLD.submitted_at)
           OR (NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
            RAISE EXCEPTION '42501: BRANCH_MANAGER cannot modify leave application fields during approval/rejection.';
        END IF;

        IF NEW.status = 'REJECTED' AND NULLIF(btrim(NEW.rejection_reason), '') IS NULL THEN
            RAISE EXCEPTION '23514: rejection_reason is mandatory when status is REJECTED.';
        END IF;

        -- Server-assigned approval metadata (never accept arbitrary client approved_by/approved_at)
        NEW.approved_by := v_actor_user_id;
        NEW.approved_at := now();
        IF NEW.status = 'APPROVED' THEN
            NEW.rejection_reason := NULL;
        END IF;

        RETURN NEW;
    END IF;

    -- All other roles fail closed
    RAISE EXCEPTION '42501: Role % is not authorized to modify leave_requests.', v_actor_role;
END;
$$;

ALTER FUNCTION public.enforce_leave_decision_integrity() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_leave_requests_updated_at ON public.leave_requests;
DROP TRIGGER IF EXISTS trg_prevent_overlapping_leave ON public.leave_requests;
DROP TRIGGER IF EXISTS trg_01_enforce_leave_decision ON public.leave_requests;

CREATE TRIGGER trg_01_enforce_leave_decision
    BEFORE UPDATE ON public.leave_requests
    FOR EACH ROW EXECUTE FUNCTION public.enforce_leave_decision_integrity();

CREATE TRIGGER trg_02_leave_requests_updated_at
    BEFORE UPDATE ON public.leave_requests
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_03_prevent_overlapping_leave
    BEFORE INSERT OR UPDATE ON public.leave_requests
    FOR EACH ROW EXECUTE FUNCTION public.prevent_overlapping_leave();

-- ----------------------------------------------------------------------------
-- 1.6 Dedicated Cryptographically Authenticated Gateway RPCs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_branch_decide_leave_request(
    p_request_id UUID,
    p_decision VARCHAR(50),
    p_rejection_reason TEXT,
    p_actor_user_id UUID,
    p_actor_email TEXT,
    p_actor_role TEXT,
    p_branch_id UUID,
    p_employee_id UUID,
    p_exp BIGINT,
    p_nonce UUID,
    p_actor_sig TEXT
)
RETURNS public.leave_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nexus_internal, public, pg_temp
AS $$
DECLARE
    v_updated public.leave_requests%ROWTYPE;
BEGIN
    IF p_actor_role IS DISTINCT FROM 'BRANCH_MANAGER' THEN
        RAISE EXCEPTION '42501: rpc_branch_decide_leave_request is restricted to BRANCH_MANAGER.';
    END IF;

    PERFORM nexus_internal.verify_gateway_actor(
        'LEAVE_DECIDE',
        p_request_id,
        'DECISION',
        p_actor_user_id,
        p_actor_email,
        p_actor_role,
        p_branch_id,
        p_employee_id,
        p_exp,
        p_nonce,
        p_actor_sig
    );

    -- Lock target row to prevent concurrent duplicate decision races
    PERFORM 1 FROM public.leave_requests WHERE id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'P0002: Leave request (%) not found.', p_request_id;
    END IF;

    UPDATE public.leave_requests
    SET status = p_decision,
        rejection_reason = CASE WHEN p_decision = 'REJECTED' THEN p_rejection_reason ELSE NULL END
    WHERE id = p_request_id
    RETURNING * INTO v_updated;

    -- Immediately clear tx context after triggers finish so same-tx follow-ups cannot reuse it
    DELETE FROM nexus_internal.tx_actor_context WHERE txid = pg_current_xact_id();

    RETURN v_updated;
EXCEPTION
    WHEN OTHERS THEN
        DELETE FROM nexus_internal.tx_actor_context WHERE txid = pg_current_xact_id();
        RAISE;
END;
$$;

ALTER FUNCTION public.rpc_branch_decide_leave_request(
    UUID, VARCHAR, TEXT, UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.rpc_branch_decide_leave_request(
    UUID, VARCHAR, TEXT, UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_branch_decide_leave_request(
    UUID, VARCHAR, TEXT, UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
) TO service_role;


CREATE OR REPLACE FUNCTION public.rpc_superadmin_update_leave_request(
    p_request_id UUID,
    p_operation_mode TEXT, -- 'DECISION' or 'CORRECTION'
    p_employee_id UUID,
    p_leave_type VARCHAR(50),
    p_start_date DATE,
    p_end_date DATE,
    p_total_days NUMERIC(4,1),
    p_reason TEXT,
    p_status VARCHAR(50),
    p_rejection_reason TEXT,
    p_approved_by UUID,
    p_approved_at TIMESTAMPTZ,
    p_actor_user_id UUID,
    p_actor_email TEXT,
    p_actor_role TEXT,
    p_branch_id UUID,
    p_actor_employee_id UUID,
    p_exp BIGINT,
    p_nonce UUID,
    p_actor_sig TEXT
)
RETURNS public.leave_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nexus_internal, public, pg_temp
AS $$
DECLARE
    v_existing public.leave_requests%ROWTYPE;
    v_updated public.leave_requests%ROWTYPE;
BEGIN
    IF p_actor_role IS DISTINCT FROM 'SUPERADMIN' THEN
        RAISE EXCEPTION '42501: rpc_superadmin_update_leave_request is restricted to SUPERADMIN.';
    END IF;

    IF p_operation_mode NOT IN ('DECISION', 'CORRECTION') THEN
        RAISE EXCEPTION '22023: p_operation_mode must be DECISION or CORRECTION.';
    END IF;

    PERFORM nexus_internal.verify_gateway_actor(
        'LEAVE_SUPERADMIN_UPDATE',
        p_request_id,
        p_operation_mode,
        p_actor_user_id,
        p_actor_email,
        p_actor_role,
        p_branch_id,
        p_actor_employee_id,
        p_exp,
        p_nonce,
        p_actor_sig
    );

    SELECT * INTO v_existing
    FROM public.leave_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'P0002: Leave request (%) not found.', p_request_id;
    END IF;

    IF p_operation_mode = 'DECISION' AND COALESCE(p_status, v_existing.status) NOT IN ('APPROVED', 'REJECTED') THEN
        RAISE EXCEPTION '22023: DECISION mode requires APPROVED or REJECTED status.';
    END IF;

    UPDATE public.leave_requests
    SET employee_id      = COALESCE(p_employee_id, v_existing.employee_id),
        leave_type       = COALESCE(p_leave_type, v_existing.leave_type),
        start_date       = COALESCE(p_start_date, v_existing.start_date),
        end_date         = COALESCE(p_end_date, v_existing.end_date),
        total_days       = COALESCE(p_total_days, v_existing.total_days),
        reason           = COALESCE(p_reason, v_existing.reason),
        status           = COALESCE(p_status, v_existing.status),
        rejection_reason = CASE
                               WHEN p_operation_mode = 'CORRECTION' THEN p_rejection_reason
                               WHEN COALESCE(p_status, v_existing.status) = 'REJECTED' THEN p_rejection_reason
                               ELSE NULL
                           END,
        approved_by      = CASE
                               WHEN p_operation_mode = 'CORRECTION' THEN p_approved_by
                               ELSE COALESCE(p_approved_by, p_actor_user_id)
                           END,
        approved_at      = CASE
                               WHEN p_operation_mode = 'CORRECTION' THEN p_approved_at
                               ELSE COALESCE(p_approved_at, now())
                           END
    WHERE id = p_request_id
    RETURNING * INTO v_updated;

    DELETE FROM nexus_internal.tx_actor_context WHERE txid = pg_current_xact_id();

    RETURN v_updated;
EXCEPTION
    WHEN OTHERS THEN
        DELETE FROM nexus_internal.tx_actor_context WHERE txid = pg_current_xact_id();
        RAISE;
END;
$$;

ALTER FUNCTION public.rpc_superadmin_update_leave_request(
    UUID, TEXT, UUID, VARCHAR, DATE, DATE, NUMERIC, TEXT, VARCHAR, TEXT, UUID, TIMESTAMPTZ,
    UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.rpc_superadmin_update_leave_request(
    UUID, TEXT, UUID, VARCHAR, DATE, DATE, NUMERIC, TEXT, VARCHAR, TEXT, UUID, TIMESTAMPTZ,
    UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_superadmin_update_leave_request(
    UUID, TEXT, UUID, VARCHAR, DATE, DATE, NUMERIC, TEXT, VARCHAR, TEXT, UUID, TIMESTAMPTZ,
    UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
) TO service_role;

-- ----------------------------------------------------------------------------
-- 1.7 RLS & Table Least-Privilege Hardening on Branch A
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS leave_manager_decide ON public.leave_requests;
DROP POLICY IF EXISTS leave_superadmin_manage ON public.leave_requests;

-- Revoke excessive anon & TRUNCATE privileges across all public tables
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated;

-- Enforce Gateway-RPC-only UPDATE on leave_requests (recommended posture)
REVOKE UPDATE, DELETE ON TABLE public.leave_requests FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.audit_logs FROM authenticated;

-- ----------------------------------------------------------------------------
-- 1.8 Employee Code Generation, Bounded Sequence & Deterministic Outbox Ordering
-- ----------------------------------------------------------------------------
ALTER SEQUENCE public.seq_branch_a_employee_code
    MAXVALUE 999999999999
    NO CYCLE;

CREATE OR REPLACE FUNCTION public.generate_employee_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_seq_val BIGINT;
BEGIN
    IF NEW.employee_code IS NULL OR btrim(NEW.employee_code) = '' THEN
        v_seq_val := nextval('public.seq_branch_a_employee_code');
        IF v_seq_val < 10000 THEN
            NEW.employee_code := 'EMP-A-' || lpad(v_seq_val::text, 4, '0');
        ELSE
            NEW.employee_code := 'EMP-A-' || v_seq_val::text;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.generate_employee_code() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.emit_employee_outbox_event()
RETURNS trigger
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
    -- Fail-fast invariant: NEVER fall back to nextval()
    IF NEW.employee_code IS NULL OR btrim(NEW.employee_code) = '' THEN
        RAISE EXCEPTION 'Invariant Violation: employee_code must be assigned before emit_employee_outbox_event() (employee id=%).', NEW.id;
    END IF;

    SELECT name INTO v_dept_name FROM public.departments WHERE id = NEW.department_id;
    SELECT title INTO v_pos_title FROM public.positions WHERE id = NEW.position_id;

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

ALTER FUNCTION public.emit_employee_outbox_event() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_employee_outbox_sync ON public.employees;
DROP TRIGGER IF EXISTS trg_generate_employee_code ON public.employees;
DROP TRIGGER IF EXISTS trg_employees_updated_at ON public.employees;

-- Deterministic alphabetical ordering for BEFORE triggers on public.employees
CREATE TRIGGER trg_01_employees_generate_code
    BEFORE INSERT ON public.employees
    FOR EACH ROW EXECUTE FUNCTION public.generate_employee_code();

CREATE TRIGGER trg_02_employees_updated_at
    BEFORE UPDATE ON public.employees
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_03_employees_outbox_sync
    BEFORE INSERT OR UPDATE ON public.employees
    FOR EACH ROW EXECUTE FUNCTION public.emit_employee_outbox_event();

-- ----------------------------------------------------------------------------
-- 1.9 Least-Privilege Function EXECUTE Grants
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.claim_outbox_batch(character varying, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_outbox_batch(character varying, integer) TO service_role;

REVOKE ALL ON FUNCTION public.mark_outbox_published(uuid, character varying) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_outbox_published(uuid, character varying) TO service_role;

REVOKE ALL ON FUNCTION public.mark_outbox_failed(uuid, character varying, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_outbox_failed(uuid, character varying, text) TO service_role;

-- Internal rollup & trigger functions: remove direct RPC exposure
REVOKE ALL ON FUNCTION public.recalculate_attendance_summary(date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_branch_audit_log() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.emit_employee_outbox_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.emit_attendance_summary_outbox_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.emit_leave_summary_outbox_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.emit_schedule_summary_outbox_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_employee_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_hard_delete_employees() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_overlapping_leave() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_attendance_check_in() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_leave_decision_integrity() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_auth_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_auth_role() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_current_employee_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_employee_id() TO authenticated, service_role;


-- ############################################################################
-- PART 2: CENTRAL BRANCH SEED (TARGET: nexus-central / wcmevigbqsmzsdqidjel)
-- ############################################################################

DO $$
DECLARE
    v_target_id CONSTANT UUID := '00000000-0000-0000-0000-000000000001'::uuid;
    v_conflict_code VARCHAR(20);
    v_conflict_id UUID;
BEGIN
    -- Precondition 1: Ensure target UUID is not assigned to a different branch code
    SELECT code INTO v_conflict_code
    FROM public.branches
    WHERE id = v_target_id;

    IF FOUND AND v_conflict_code IS DISTINCT FROM 'BRANCH-A' THEN
        RAISE EXCEPTION 'Seed conflict: UUID % already belongs to branch code %.', v_target_id, v_conflict_code;
    END IF;

    -- Precondition 2: Ensure code 'BRANCH-A' is not assigned to a different UUID
    SELECT id INTO v_conflict_id
    FROM public.branches
    WHERE code = 'BRANCH-A';

    IF FOUND AND v_conflict_id IS DISTINCT FROM v_target_id THEN
        RAISE EXCEPTION 'Seed conflict: Code BRANCH-A already exists with UUID %.', v_conflict_id;
    END IF;
END $$;

-- Idempotent non-destructive insert (never overwrites unrelated customized columns)
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

-- Post-seed assertion
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
