-- ============================================================================
-- NEXUS HR — PHASE 3.12C: SQL REMEDIATION V2.7 DRAFT (BRANCH A)
-- Target Database: nexus-branch-a (Supabase Project Ref: uneycmbqqpkifwhwzbes)
-- Baseline: 002_branch_a_schema.sql (preserved unmodified)
-- Supersedes Draft: docs/architecture/phase_3_12a/PHASE_3_12A_REMEDIATION_V2_6.sql
-- Status: LOCAL DRAFT ONLY — DO NOT EXECUTE WITHOUT PHASE 3.12D APPROVAL
-- ============================================================================
-- Key Remediation Items Included:
--   [B-1] key_id lookup, is_active, activated_at, rotated_at, expires_at, revoked_at,
--         and 12-field v2.7 canonical payload binding ('v2.7'|key_id|...)
--   [B-2] Tri-state SUPERADMIN partial CORRECTION semantics (p_set_rejection_reason,
--         p_set_approved_by, p_set_approved_at) + resulting-row constraint validation
--   [B-3] RPC-only leave_requests mutation (REVOKE UPDATE + RESTRICTIVE deny policy),
--         hardened scope/branch/target verification in verify_gateway_actor(),
--         strict BRANCH_MANAGER / SUPERADMIN trigger rules, and bounded non-blocking
--         nonce cleanup (FOR UPDATE SKIP LOCKED + maintenance helper)
--   [V2.6 Carryover] Employee code sequence expansion (MAXVALUE 999999999999 NO CYCLE),
--         fail-fast emit_employee_outbox_event(), deterministic trigger ordering,
--         and least-privilege function/table grants
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1.1 Preconditions Verification (Fail-Fast)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_has_pgcrypto BOOLEAN;
    v_branch_cfg RECORD;
BEGIN
    IF to_regclass('public.branch_config') IS NULL
       OR to_regclass('public.employees') IS NULL
       OR to_regclass('public.leave_requests') IS NULL
       OR to_regclass('public.audit_logs') IS NULL
       OR to_regclass('public.sync_outbox') IS NULL
       OR to_regclass('public.seq_branch_a_employee_code') IS NULL THEN
        RAISE EXCEPTION 'Precondition failed: Expected Branch A schema objects are missing.';
    END IF;

    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') INTO v_has_pgcrypto;
    IF NOT v_has_pgcrypto THEN
        RAISE EXCEPTION 'Precondition failed: pgcrypto extension is required.';
    END IF;

    SELECT id, branch_code, is_active INTO v_branch_cfg
    FROM public.branch_config
    LIMIT 1;

    IF NOT FOUND
       OR v_branch_cfg.id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid
       OR v_branch_cfg.branch_code IS DISTINCT FROM 'BRANCH-A' THEN
        RAISE EXCEPTION 'Precondition failed: branch_config does not match expected BRANCH-A canonical identity.';
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1.2 Private Internal Security Schema (Inaccessible to anon, authenticated, service_role)
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS nexus_internal AUTHORIZATION postgres;

REVOKE ALL ON SCHEMA nexus_internal FROM PUBLIC, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA nexus_internal
    REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA nexus_internal
    REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA nexus_internal
    REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;

-- Gateway HMAC signing key ledger supporting zero-downtime grace-period rotation,
-- expiration, and immediate revocation. Never stores literals in VCS/migrations.
CREATE TABLE IF NOT EXISTS nexus_internal.gateway_signing_keys (
    key_id VARCHAR(64) PRIMARY KEY,
    hmac_secret TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    rotated_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

ALTER TABLE nexus_internal.gateway_signing_keys
    ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

ALTER TABLE nexus_internal.gateway_signing_keys
    DROP CONSTRAINT IF EXISTS chk_gateway_signing_key_id_format,
    DROP CONSTRAINT IF EXISTS chk_gateway_signing_key_secret_len,
    DROP CONSTRAINT IF EXISTS chk_gateway_signing_key_state;

ALTER TABLE nexus_internal.gateway_signing_keys
    ADD CONSTRAINT chk_gateway_signing_key_id_format CHECK (key_id ~ '^[A-Za-z0-9._-]{1,64}$'),
    ADD CONSTRAINT chk_gateway_signing_key_secret_len CHECK (octet_length(hmac_secret) >= 32),
    ADD CONSTRAINT chk_gateway_signing_key_state CHECK (revoked_at IS NULL OR is_active = FALSE);

REVOKE ALL ON TABLE nexus_internal.gateway_signing_keys FROM PUBLIC, anon, authenticated, service_role;

-- Single-use outbound actor nonce ledger preventing replay within 120s TTL window
CREATE TABLE IF NOT EXISTS nexus_internal.used_actor_nonces (
    nonce UUID PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_used_actor_nonces_expires
    ON nexus_internal.used_actor_nonces (expires_at);

REVOKE ALL ON TABLE nexus_internal.used_actor_nonces FROM PUBLIC, anon, authenticated, service_role;

-- Unforgeable per-transaction actor context populated ONLY after HMAC + DB verification
CREATE TABLE IF NOT EXISTS nexus_internal.tx_actor_context (
    txid XID8 PRIMARY KEY,
    actor_user_id UUID NOT NULL,
    actor_email VARCHAR(255) NOT NULL,
    actor_role VARCHAR(50) NOT NULL,
    branch_id UUID,
    employee_id UUID,
    action_scope VARCHAR(64) NOT NULL,
    operation_mode VARCHAR(32) NOT NULL,
    key_id VARCHAR(64) NOT NULL,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE nexus_internal.tx_actor_context
    ADD COLUMN IF NOT EXISTS key_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_tx_actor_context_verified_at
    ON nexus_internal.tx_actor_context (verified_at);

REVOKE ALL ON TABLE nexus_internal.tx_actor_context FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 1.3 Bounded Concurrency-Safe Nonce Cleanup Maintenance Function (B-3.D)
-- ----------------------------------------------------------------------------
-- Designed for controlled scheduled maintenance (e.g., pg_cron or admin worker)
-- AND bounded probabilistic calls. Never deletes unexpired nonces and uses
-- FOR UPDATE SKIP LOCKED so concurrent RPCs claiming new nonces never block.
CREATE OR REPLACE FUNCTION nexus_internal.cleanup_expired_actor_nonces(
    p_batch_size INTEGER DEFAULT 250
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nexus_internal, pg_temp
AS $$
DECLARE
    v_limit INTEGER;
    v_deleted INTEGER := 0;
BEGIN
    v_limit := LEAST(GREATEST(COALESCE(p_batch_size, 250), 1), 1000);

    WITH doomed AS (
        SELECT nonce
        FROM nexus_internal.used_actor_nonces
        WHERE expires_at < now() - INTERVAL '5 minutes'
        ORDER BY expires_at ASC
        LIMIT v_limit
        FOR UPDATE SKIP LOCKED
    ),
    removed AS (
        DELETE FROM nexus_internal.used_actor_nonces n
        USING doomed d
        WHERE n.nonce = d.nonce
        RETURNING 1
    )
    SELECT count(*)::integer INTO v_deleted FROM removed;

    WITH stale_ctx AS (
        SELECT txid
        FROM nexus_internal.tx_actor_context
        WHERE verified_at < now() - INTERVAL '5 minutes'
        ORDER BY verified_at ASC
        LIMIT LEAST(v_limit, 100)
        FOR UPDATE SKIP LOCKED
    )
    DELETE FROM nexus_internal.tx_actor_context c
    USING stale_ctx s
    WHERE c.txid = s.txid;

    RETURN v_deleted;
END;
$$;

ALTER FUNCTION nexus_internal.cleanup_expired_actor_nonces(INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION nexus_internal.cleanup_expired_actor_nonces(INTEGER)
    FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 1.4 Cryptographic Actor Verification Function (v2.7 Contract, Internal Only)
-- ----------------------------------------------------------------------------
-- Drop legacy v2.6 11-argument overload if present so only the v2.7 12-argument contract exists
DROP FUNCTION IF EXISTS nexus_internal.verify_gateway_actor(
    TEXT, UUID, TEXT, UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
);

CREATE OR REPLACE FUNCTION nexus_internal.verify_gateway_actor(
    p_key_id TEXT,
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
    v_key_rec nexus_internal.gateway_signing_keys%ROWTYPE;
    v_canonical TEXT;
    v_expected_hex TEXT;
    v_nonce_claimed UUID;
    v_branch_cfg RECORD;
    v_emp_user_id UUID;
    v_emp_active BOOLEAN;
    v_emp_deleted BOOLEAN;
    v_target_emp_id UUID;
    v_norm_key_id TEXT;
    v_norm_email TEXT;
    v_ctx nexus_internal.tx_actor_context;
BEGIN
    -- 1. Transport role boundary check (PostgREST service_role OR postgres test superuser)
    IF session_user = 'authenticator' THEN
        IF current_setting('role', true) IS DISTINCT FROM 'service_role'
           OR NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' IS DISTINCT FROM 'service_role' THEN
            RAISE EXCEPTION '42501: Gateway RPC requires authenticated service_role transport.';
        END IF;
    ELSIF session_user IS DISTINCT FROM 'postgres' THEN
        RAISE EXCEPTION '42501: Unauthorized PostgreSQL session caller (%).', session_user;
    END IF;

    -- 2. Strict parameter presence and delimiter-injection validation (fail closed)
    v_norm_key_id := btrim(COALESCE(p_key_id, ''));
    IF v_norm_key_id !~ '^[A-Za-z0-9._-]{1,64}$' THEN
        RAISE EXCEPTION '42501: Missing or malformed Gateway HMAC key_id.';
    END IF;

    IF p_action_scope IS NULL OR p_action_scope NOT IN ('LEAVE_DECIDE', 'LEAVE_SUPERADMIN_UPDATE') THEN
        RAISE EXCEPTION '42501: Unsupported or NULL Gateway action_scope.';
    END IF;

    IF p_operation_mode IS NULL OR p_operation_mode NOT IN ('DECISION', 'CORRECTION') THEN
        RAISE EXCEPTION '22023: Invalid or NULL operation_mode.';
    END IF;

    IF p_target_id IS NULL THEN
        RAISE EXCEPTION '22023: target_id is required.';
    END IF;

    IF p_actor_user_id IS NULL THEN
        RAISE EXCEPTION '42501: Missing actor_user_id (fails closed).';
    END IF;

    v_norm_email := lower(btrim(COALESCE(p_actor_email, '')));
    IF v_norm_email = '' OR v_norm_email ~ '[|\r\n]' THEN
        RAISE EXCEPTION '42501: Missing or malformed actor_email (fails closed).';
    END IF;

    IF p_actor_role IS NULL OR p_actor_role NOT IN ('SUPERADMIN', 'BRANCH_MANAGER') THEN
        RAISE EXCEPTION '42501: Unauthorized or NULL actor_role (fails closed).';
    END IF;

    -- Scoped role-to-operation enforcement (fail closed before crypto/nonce claim)
    IF p_action_scope = 'LEAVE_DECIDE'
       AND (p_actor_role IS DISTINCT FROM 'BRANCH_MANAGER' OR p_operation_mode IS DISTINCT FROM 'DECISION') THEN
        RAISE EXCEPTION '42501: LEAVE_DECIDE requires BRANCH_MANAGER role in DECISION mode.';
    END IF;

    IF p_action_scope = 'LEAVE_SUPERADMIN_UPDATE'
       AND p_actor_role IS DISTINCT FROM 'SUPERADMIN' THEN
        RAISE EXCEPTION '42501: LEAVE_SUPERADMIN_UPDATE is strictly restricted to SUPERADMIN.';
    END IF;

    IF p_exp IS NULL OR p_nonce IS NULL OR p_actor_sig IS NULL OR p_actor_sig !~ '^[0-9a-fA-F]{64}$' THEN
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

    -- 4. Exact signing key lookup (supports grace-period rotation; never falls back across keys)
    SELECT * INTO v_key_rec
    FROM nexus_internal.gateway_signing_keys
    WHERE key_id = v_norm_key_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION '42501: Unknown Gateway HMAC signing key (%).', v_norm_key_id;
    END IF;
    IF v_key_rec.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION '42501: Gateway HMAC signing key (%) has been revoked.', v_norm_key_id;
    END IF;
    IF v_key_rec.is_active IS NOT TRUE THEN
        RAISE EXCEPTION '42501: Gateway HMAC signing key (%) is inactive.', v_norm_key_id;
    END IF;
    IF v_key_rec.expires_at IS NOT NULL AND v_key_rec.expires_at <= now() THEN
        RAISE EXCEPTION '42501: Gateway HMAC signing key (%) grace period has expired.', v_norm_key_id;
    END IF;
    IF octet_length(v_key_rec.hmac_secret) < 32 THEN
        RAISE EXCEPTION '55000: Gateway HMAC signing key (%) violates 256-bit minimum length.', v_norm_key_id;
    END IF;

    -- 5. Build exact v2.7 12-field canonical payload and verify HMAC-SHA256 digest
    -- Must match gateway/src/security/hmac-signer.ts buildCanonicalActorPayload() byte-for-byte.
    v_canonical := concat_ws('|',
        'v2.7',
        v_key_rec.key_id,
        p_action_scope,
        p_target_id::text,
        p_operation_mode,
        p_actor_user_id::text,
        v_norm_email,
        p_actor_role,
        COALESCE(p_branch_id::text, ''),
        COALESCE(p_employee_id::text, ''),
        p_exp::text,
        p_nonce::text
    );

    v_expected_hex := encode(
        extensions.hmac(convert_to(v_canonical, 'UTF8'), convert_to(v_key_rec.hmac_secret, 'UTF8'), 'sha256'),
        'hex'
    );

    IF encode(extensions.digest(convert_to(v_expected_hex, 'UTF8'), 'sha256'), 'hex')
       IS DISTINCT FROM
       encode(extensions.digest(convert_to(lower(p_actor_sig), 'UTF8'), 'sha256'), 'hex') THEN
        RAISE EXCEPTION '42501: Forged or invalid Gateway actor signature.';
    END IF;

    -- 6. Atomic single-use nonce claim + bounded opportunistic cleanup (~5% sample, non-blocking)
    INSERT INTO nexus_internal.used_actor_nonces (nonce, expires_at)
    VALUES (p_nonce, to_timestamp(p_exp))
    ON CONFLICT (nonce) DO NOTHING
    RETURNING nonce INTO v_nonce_claimed;

    IF v_nonce_claimed IS NULL THEN
        RAISE EXCEPTION '42501: Replayed Gateway actor credential (nonce already consumed).';
    END IF;

    IF mod(('x' || substr(replace(p_nonce::text, '-', ''), 1, 8))::bit(32)::bigint, 20) = 0 THEN
        PERFORM nexus_internal.cleanup_expired_actor_nonces(50);
    END IF;

    -- 7. Live database branch, actor employee, and target record cross-verification
    SELECT id, branch_code, is_active INTO v_branch_cfg
    FROM public.branch_config
    WHERE id = '00000000-0000-0000-0000-000000000001'::uuid;

    IF NOT FOUND OR v_branch_cfg.is_active IS NOT TRUE THEN
        RAISE EXCEPTION '42501: Branch A configuration is missing or inactive.';
    END IF;

    IF p_actor_role = 'BRANCH_MANAGER' THEN
        IF p_branch_id IS DISTINCT FROM v_branch_cfg.id THEN
            RAISE EXCEPTION '42501: Branch ID mismatch for BRANCH_MANAGER.';
        END IF;

        IF p_employee_id IS NULL THEN
            RAISE EXCEPTION '42501: Active employee identity is required for BRANCH_MANAGER.';
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
        IF p_branch_id IS NOT NULL AND p_branch_id IS DISTINCT FROM v_branch_cfg.id THEN
            RAISE EXCEPTION '42501: Supplied branch_id (%) does not match Branch A.', p_branch_id;
        END IF;

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

    -- Verify target leave request exists and belongs to an employee in this Branch A node
    SELECT lr.employee_id INTO v_target_emp_id
    FROM public.leave_requests lr
    JOIN public.employees e ON e.id = lr.employee_id
    WHERE lr.id = p_target_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'P0002: Leave request (%) not found in Branch A.', p_target_id;
    END IF;

    -- 8. Record verified actor identity scoped strictly to pg_current_xact_id()
    INSERT INTO nexus_internal.tx_actor_context (
        txid, actor_user_id, actor_email, actor_role, branch_id,
        employee_id, action_scope, operation_mode, key_id, verified_at
    ) VALUES (
        pg_current_xact_id(), p_actor_user_id, v_norm_email, p_actor_role,
        COALESCE(p_branch_id, v_branch_cfg.id), p_employee_id, p_action_scope,
        p_operation_mode, v_key_rec.key_id, now()
    )
    ON CONFLICT (txid) DO UPDATE SET
        actor_user_id  = EXCLUDED.actor_user_id,
        actor_email    = EXCLUDED.actor_email,
        actor_role     = EXCLUDED.actor_role,
        branch_id      = EXCLUDED.branch_id,
        employee_id    = EXCLUDED.employee_id,
        action_scope   = EXCLUDED.action_scope,
        operation_mode = EXCLUDED.operation_mode,
        key_id         = EXCLUDED.key_id,
        verified_at    = EXCLUDED.verified_at
    RETURNING * INTO v_ctx;

    RETURN v_ctx;
END;
$$;

ALTER FUNCTION nexus_internal.verify_gateway_actor(
    TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
) OWNER TO postgres;

REVOKE ALL ON FUNCTION nexus_internal.verify_gateway_actor(
    TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 1.5 Fail-Closed Auth Helpers & Trigger-Safe Audit Logger
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
-- 1.6 Fail-Closed Leave Request Decision & Correction Integrity Trigger (B-2, B-3.C)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_leave_decision_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nexus_internal, public, pg_temp
AS $$
DECLARE
    v_ctx nexus_internal.tx_actor_context%ROWTYPE;
    v_is_self_emp BOOLEAN;
BEGIN
    -- Strictly require unforgeable Gateway tx_actor_context for ALL leave_requests UPDATEs.
    -- Direct service_role or authenticated DML without verified Gateway RPC context fails closed.
    SELECT * INTO v_ctx
    FROM nexus_internal.tx_actor_context
    WHERE txid = pg_current_xact_id();

    IF NOT FOUND OR v_ctx.actor_user_id IS NULL OR v_ctx.actor_role IS NULL THEN
        RAISE EXCEPTION '42501: Direct leave_requests UPDATE without verified Gateway actor context is prohibited.';
    END IF;

    -- Validate final resulting row invariants cleanly for ALL roles
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION '42501: Immutable leave record identifiers/timestamps cannot be altered.';
    END IF;

    IF btrim(COALESCE(NEW.reason, '')) = '' THEN
        RAISE EXCEPTION '23514: Leave reason cannot be blank.';
    END IF;
    IF NEW.end_date < NEW.start_date THEN
        RAISE EXCEPTION '23514: end_date must be on or after start_date.';
    END IF;
    IF NEW.total_days IS NULL OR NEW.total_days <= 0 THEN
        RAISE EXCEPTION '23514: total_days must be greater than zero.';
    END IF;
    IF NEW.status = 'REJECTED' AND NULLIF(btrim(NEW.rejection_reason), '') IS NULL THEN
        RAISE EXCEPTION '23514: rejection_reason is mandatory when status is REJECTED.';
    END IF;

    -- PATH A: SUPERADMIN (Verified RPC context only; preserves integrity & CHECK constraints)
    IF v_ctx.actor_role = 'SUPERADMIN' THEN
        IF v_ctx.action_scope IS DISTINCT FROM 'LEAVE_SUPERADMIN_UPDATE' THEN
            RAISE EXCEPTION '42501: Invalid action scope for SUPERADMIN leave mutation.';
        END IF;

        IF v_ctx.operation_mode = 'DECISION' THEN
            IF NEW.status NOT IN ('APPROVED', 'REJECTED') THEN
                RAISE EXCEPTION '22023: SUPERADMIN DECISION mode requires APPROVED or REJECTED status.';
            END IF;
            NEW.approved_by := v_ctx.actor_user_id;
            NEW.approved_at := now();
            IF NEW.status = 'APPROVED' THEN
                NEW.rejection_reason := NULL;
            END IF;
        END IF;

        -- Validate referenced employee exists and is not deleted when changed
        IF NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
            PERFORM 1 FROM public.employees
            WHERE id = NEW.employee_id AND is_deleted = FALSE;
            IF NOT FOUND THEN
                RAISE EXCEPTION '23503: Target employee_id (%) does not exist or is deleted.', NEW.employee_id;
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    -- PATH B: BRANCH_MANAGER (Strict DECISION-only rules; no self-approval; protected fields locked)
    IF v_ctx.actor_role = 'BRANCH_MANAGER' THEN
        IF v_ctx.action_scope IS DISTINCT FROM 'LEAVE_DECIDE'
           OR v_ctx.operation_mode IS DISTINCT FROM 'DECISION' THEN
            RAISE EXCEPTION '42501: BRANCH_MANAGER may only mutate via LEAVE_DECIDE DECISION RPC.';
        END IF;

        IF v_ctx.employee_id IS NULL THEN
            RAISE EXCEPTION '42501: BRANCH_MANAGER requires a verified active employee identity.';
        END IF;

        IF OLD.status IS DISTINCT FROM 'PENDING' THEN
            RAISE EXCEPTION '42501: BRANCH_MANAGER may only decide requests in PENDING status (current: %).', OLD.status;
        END IF;

        IF NEW.status NOT IN ('APPROVED', 'REJECTED') THEN
            RAISE EXCEPTION '22023: BRANCH_MANAGER decision status must be APPROVED or REJECTED.';
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM public.employees e
            WHERE e.id = OLD.employee_id
              AND e.user_auth_id = v_ctx.actor_user_id
        ) INTO v_is_self_emp;

        IF (OLD.employee_id IS NOT DISTINCT FROM v_ctx.employee_id)
           OR (NEW.employee_id IS NOT DISTINCT FROM v_ctx.employee_id)
           OR v_is_self_emp THEN
            RAISE EXCEPTION '42501: Self-approval by BRANCH_MANAGER is strictly prohibited.';
        END IF;

        IF (NEW.employee_id IS DISTINCT FROM OLD.employee_id)
           OR (NEW.leave_type IS DISTINCT FROM OLD.leave_type)
           OR (NEW.start_date IS DISTINCT FROM OLD.start_date)
           OR (NEW.end_date IS DISTINCT FROM OLD.end_date)
           OR (NEW.total_days IS DISTINCT FROM OLD.total_days)
           OR (NEW.reason IS DISTINCT FROM OLD.reason) THEN
            RAISE EXCEPTION '42501: BRANCH_MANAGER cannot modify leave application fields during approval/rejection.';
        END IF;

        NEW.approved_by := v_ctx.actor_user_id;
        NEW.approved_at := now();
        IF NEW.status = 'APPROVED' THEN
            NEW.rejection_reason := NULL;
        ELSE
            NEW.rejection_reason := btrim(NEW.rejection_reason);
        END IF;

        RETURN NEW;
    END IF;

    RAISE EXCEPTION '42501: Role % is not authorized to modify leave_requests.', v_ctx.actor_role;
END;
$$;

ALTER FUNCTION public.enforce_leave_decision_integrity() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_leave_requests_updated_at ON public.leave_requests;
DROP TRIGGER IF EXISTS trg_prevent_overlapping_leave ON public.leave_requests;
DROP TRIGGER IF EXISTS trg_01_enforce_leave_decision ON public.leave_requests;
DROP TRIGGER IF EXISTS trg_02_leave_requests_updated_at ON public.leave_requests;
DROP TRIGGER IF EXISTS trg_03_prevent_overlapping_leave ON public.leave_requests;

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
-- 1.7 Dedicated Gateway RPCs (v2.7 Exact Parameter Signatures)
-- ----------------------------------------------------------------------------
-- Remove legacy v2.6 overloads if present
DROP FUNCTION IF EXISTS public.rpc_branch_decide_leave_request(
    UUID, VARCHAR, TEXT, UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
);
DROP FUNCTION IF EXISTS public.rpc_superadmin_update_leave_request(
    UUID, TEXT, UUID, VARCHAR, DATE, DATE, NUMERIC, TEXT, VARCHAR, TEXT, UUID, TIMESTAMPTZ,
    UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
);

CREATE OR REPLACE FUNCTION public.rpc_branch_decide_leave_request(
    p_key_id TEXT,
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
        p_key_id,
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

    -- Lock target row to serialize concurrent decisions
    PERFORM 1 FROM public.leave_requests WHERE id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'P0002: Leave request (%) not found.', p_request_id;
    END IF;

    UPDATE public.leave_requests
    SET status = p_decision,
        rejection_reason = CASE WHEN p_decision = 'REJECTED' THEN NULLIF(btrim(p_rejection_reason), '') ELSE NULL END
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

ALTER FUNCTION public.rpc_branch_decide_leave_request(
    TEXT, UUID, VARCHAR, TEXT, UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.rpc_branch_decide_leave_request(
    TEXT, UUID, VARCHAR, TEXT, UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_branch_decide_leave_request(
    TEXT, UUID, VARCHAR, TEXT, UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
) TO service_role;


CREATE OR REPLACE FUNCTION public.rpc_superadmin_update_leave_request(
    p_key_id TEXT,
    p_request_id UUID,
    p_operation_mode TEXT,
    p_employee_id UUID DEFAULT NULL,
    p_leave_type VARCHAR(50) DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL,
    p_total_days NUMERIC(4,1) DEFAULT NULL,
    p_reason TEXT DEFAULT NULL,
    p_status VARCHAR(50) DEFAULT NULL,
    p_rejection_reason TEXT DEFAULT NULL,
    p_approved_by UUID DEFAULT NULL,
    p_approved_at TIMESTAMPTZ DEFAULT NULL,
    p_set_rejection_reason BOOLEAN DEFAULT FALSE,
    p_set_approved_by BOOLEAN DEFAULT FALSE,
    p_set_approved_at BOOLEAN DEFAULT FALSE,
    p_actor_user_id UUID DEFAULT NULL,
    p_actor_email TEXT DEFAULT NULL,
    p_actor_role TEXT DEFAULT NULL,
    p_branch_id UUID DEFAULT NULL,
    p_actor_employee_id UUID DEFAULT NULL,
    p_exp BIGINT DEFAULT NULL,
    p_nonce UUID DEFAULT NULL,
    p_actor_sig TEXT DEFAULT NULL
)
RETURNS public.leave_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nexus_internal, public, pg_temp
AS $$
DECLARE
    v_existing public.leave_requests%ROWTYPE;
    v_updated public.leave_requests%ROWTYPE;
    v_next_reason TEXT;
    v_next_status VARCHAR(50);
    v_next_rejection_reason TEXT;
    v_next_approved_by UUID;
    v_next_approved_at TIMESTAMPTZ;
BEGIN
    IF p_actor_role IS DISTINCT FROM 'SUPERADMIN' THEN
        RAISE EXCEPTION '42501: rpc_superadmin_update_leave_request is restricted to SUPERADMIN.';
    END IF;

    IF p_operation_mode NOT IN ('DECISION', 'CORRECTION') THEN
        RAISE EXCEPTION '22023: p_operation_mode must be DECISION or CORRECTION.';
    END IF;

    PERFORM nexus_internal.verify_gateway_actor(
        p_key_id,
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

    IF p_reason IS NOT NULL AND btrim(p_reason) = '' THEN
        RAISE EXCEPTION '23514: reason cannot be blank.';
    END IF;

    v_next_reason := CASE WHEN p_reason IS NOT NULL THEN btrim(p_reason) ELSE v_existing.reason END;
    v_next_status := COALESCE(p_status, v_existing.status);

    IF p_operation_mode = 'DECISION' THEN
        IF v_next_status NOT IN ('APPROVED', 'REJECTED') THEN
            RAISE EXCEPTION '22023: DECISION mode requires APPROVED or REJECTED status.';
        END IF;
        v_next_rejection_reason := CASE
            WHEN v_next_status = 'REJECTED' THEN NULLIF(btrim(p_rejection_reason), '')
            ELSE NULL
        END;
        v_next_approved_by := p_actor_user_id;
        v_next_approved_at := now();
    ELSE
        -- CORRECTION mode: omitted nullable fields preserve existing values cleanly
        v_next_rejection_reason := CASE
            WHEN COALESCE(p_set_rejection_reason, FALSE) THEN NULLIF(btrim(p_rejection_reason), '')
            ELSE v_existing.rejection_reason
        END;
        v_next_approved_by := CASE
            WHEN COALESCE(p_set_approved_by, FALSE) THEN p_approved_by
            ELSE v_existing.approved_by
        END;
        v_next_approved_at := CASE
            WHEN COALESCE(p_set_approved_at, FALSE) THEN p_approved_at
            ELSE v_existing.approved_at
        END;
    END IF;

    -- Validate final resulting row state before executing UPDATE
    IF COALESCE(p_end_date, v_existing.end_date) < COALESCE(p_start_date, v_existing.start_date) THEN
        RAISE EXCEPTION '23514: end_date must be on or after start_date.';
    END IF;
    IF COALESCE(p_total_days, v_existing.total_days) <= 0 THEN
        RAISE EXCEPTION '23514: total_days must be positive.';
    END IF;
    IF v_next_status = 'REJECTED' AND v_next_rejection_reason IS NULL THEN
        RAISE EXCEPTION '23514: Resulting REJECTED leave request requires a non-empty rejection_reason.';
    END IF;

    UPDATE public.leave_requests
    SET employee_id      = COALESCE(p_employee_id, v_existing.employee_id),
        leave_type       = COALESCE(p_leave_type, v_existing.leave_type),
        start_date       = COALESCE(p_start_date, v_existing.start_date),
        end_date         = COALESCE(p_end_date, v_existing.end_date),
        total_days       = COALESCE(p_total_days, v_existing.total_days),
        reason           = v_next_reason,
        status           = v_next_status,
        rejection_reason = v_next_rejection_reason,
        approved_by      = v_next_approved_by,
        approved_at      = v_next_approved_at
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
    TEXT, UUID, TEXT, UUID, VARCHAR, DATE, DATE, NUMERIC, TEXT, VARCHAR, TEXT, UUID, TIMESTAMPTZ,
    BOOLEAN, BOOLEAN, BOOLEAN, UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.rpc_superadmin_update_leave_request(
    TEXT, UUID, TEXT, UUID, VARCHAR, DATE, DATE, NUMERIC, TEXT, VARCHAR, TEXT, UUID, TIMESTAMPTZ,
    BOOLEAN, BOOLEAN, BOOLEAN, UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_superadmin_update_leave_request(
    TEXT, UUID, TEXT, UUID, VARCHAR, DATE, DATE, NUMERIC, TEXT, VARCHAR, TEXT, UUID, TIMESTAMPTZ,
    BOOLEAN, BOOLEAN, BOOLEAN, UUID, TEXT, TEXT, UUID, UUID, BIGINT, UUID, TEXT
) TO service_role;

-- ----------------------------------------------------------------------------
-- 1.8 RLS Defense-in-Depth & Table Least-Privilege Hardening (B-3.A)
-- ----------------------------------------------------------------------------
-- Drop legacy permissive UPDATE policy and install explicit RESTRICTIVE deny-all UPDATE
-- policy so direct updates remain blocked even if a permissive policy is added later.
-- Note: Existing leave_select (FOR SELECT) and leave_self_submit (FOR INSERT) are permissive
-- and unaffected because RESTRICTIVE policy scope is limited strictly to FOR UPDATE.
DROP POLICY IF EXISTS "leave_manager_decide" ON public.leave_requests;
DROP POLICY IF EXISTS "leave_superadmin_manage" ON public.leave_requests;
DROP POLICY IF EXISTS "leave_deny_direct_update" ON public.leave_requests;

CREATE POLICY "leave_deny_direct_update"
    ON public.leave_requests
    AS RESTRICTIVE
    FOR UPDATE
    TO authenticated
    USING (FALSE)
    WITH CHECK (FALSE);

-- Primary table-level privilege protection: enforce RPC-only leave mutations
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE UPDATE, DELETE ON TABLE public.leave_requests FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.audit_logs FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1.9 Employee Code Sequence, Fail-Fast Outbox & Deterministic Trigger Order
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
DROP TRIGGER IF EXISTS trg_01_employees_generate_code ON public.employees;
DROP TRIGGER IF EXISTS trg_02_employees_updated_at ON public.employees;
DROP TRIGGER IF EXISTS trg_03_employees_outbox_sync ON public.employees;

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
-- 1.10 Least-Privilege Function EXECUTE Grants
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.claim_outbox_batch(character varying, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_outbox_batch(character varying, integer) TO service_role;

REVOKE ALL ON FUNCTION public.mark_outbox_published(uuid, character varying) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_outbox_published(uuid, character varying) TO service_role;

REVOKE ALL ON FUNCTION public.mark_outbox_failed(uuid, character varying, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_outbox_failed(uuid, character varying, text) TO service_role;

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

COMMIT;
