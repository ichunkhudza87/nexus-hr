-- ============================================================================
-- NEXUS HR — PHASE 3.12F: READ-ONLY STAGE VERIFICATION QUERIES
-- STRICTLY READ-ONLY (SELECT ONLY — ZERO DDL, ZERO DML)
-- ============================================================================

-- ============================================================================
-- STAGE 0 — PRE-EXECUTION CHECKS (RUN ON BOTH DATABASES SEPARATELY)
-- ============================================================================

-- [Target: nexus-branch-a | uneycmbqqpkifwhwzbes] Stage 0 Check
SELECT version() AS pg_version,
       (SELECT count(*) FROM public.branch_config) AS branch_config_rows,
       (SELECT to_regnamespace('nexus_internal') IS NOT NULL) AS has_nexus_internal,
       (SELECT count(*) FROM public.employees) AS employees_cnt,
       (SELECT count(*) FROM public.leave_requests) AS leave_requests_cnt,
       (SELECT count(*) FROM public.audit_logs) AS audit_logs_cnt;

-- [Target: nexus-central | wcmevigbqsmzsdqidjel] Stage 0 Check
SELECT version() AS pg_version,
       (SELECT count(*) FROM public.branches) AS branches_cnt,
       (SELECT count(*) FROM public.user_profiles) AS user_profiles_cnt,
       (SELECT count(*) FROM public.employee_directory) AS emp_dir_cnt;

-- ============================================================================
-- STAGE 1 — POST-COMPATIBILITY CHECKS
-- [Target: nexus-branch-a | uneycmbqqpkifwhwzbes]
-- ============================================================================
SELECT id, branch_code, branch_name, operating_timezone,
       attendance_grace_period_mins, max_overtime_hours_per_day, is_active
FROM public.branch_config;

SELECT format_type(a.atttypid, a.atttypmod) AS col_type,
       a.attnotnull AS is_not_null,
       pg_get_expr(d.adbin, d.adrelid) AS default_expr
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = 'public'
  AND c.relname = 'branch_config'
  AND a.attname = 'is_active'
  AND NOT a.attisdropped;

-- ============================================================================
-- STAGE 2 — POST-SECURITY-REMEDIATION CHECKS
-- [Target: nexus-branch-a | uneycmbqqpkifwhwzbes]
-- ============================================================================

-- 2A. Verify nexus_internal tables & tx_actor_context.key_id NOT NULL
SELECT c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'nexus_internal' AND c.relkind = 'r'
ORDER BY c.relname;

SELECT format_type(a.atttypid, a.atttypmod) AS key_id_type,
       a.attnotnull AS key_id_not_null
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'nexus_internal'
  AND c.relname = 'tx_actor_context'
  AND a.attname = 'key_id'
  AND NOT a.attisdropped;

-- 2B. Verify service_role & authenticated direct DML restrictions (D1-01)
SELECT r.rolname,
       has_table_privilege(r.rolname, 'public.leave_requests', 'SELECT') AS lr_sel,
       has_table_privilege(r.rolname, 'public.leave_requests', 'INSERT') AS lr_ins,
       has_table_privilege(r.rolname, 'public.leave_requests', 'UPDATE') AS lr_upd,
       has_table_privilege(r.rolname, 'public.leave_requests', 'DELETE') AS lr_del,
       has_table_privilege(r.rolname, 'public.leave_requests', 'TRUNCATE') AS lr_trunc,
       has_table_privilege(r.rolname, 'public.audit_logs', 'SELECT') AS al_sel,
       has_table_privilege(r.rolname, 'public.audit_logs', 'INSERT') AS al_ins,
       has_table_privilege(r.rolname, 'public.audit_logs', 'UPDATE') AS al_upd,
       has_table_privilege(r.rolname, 'public.audit_logs', 'DELETE') AS al_del,
       has_table_privilege(r.rolname, 'public.audit_logs', 'TRUNCATE') AS al_trunc
FROM pg_roles r
WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY r.rolname;

-- 2C. Verify Gateway RPC & internal function EXECUTE privileges + search_path
SELECT p.pronamespace::regnamespace::text AS schema_name,
       p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS sec_definer,
       p.proconfig AS config,
       has_function_privilege('public', p.oid, 'EXECUTE') AS pub_exec,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_exec
FROM pg_proc p
WHERE p.pronamespace::regnamespace::text IN ('public', 'nexus_internal')
  AND p.proname IN (
      'verify_gateway_actor',
      'cleanup_expired_actor_nonces',
      'rpc_branch_decide_leave_request',
      'rpc_superadmin_update_leave_request',
      'enforce_leave_decision_integrity',
      'record_branch_audit_log',
      'prevent_hard_delete_leave_requests',
      'prevent_truncate_protected_tables',
      'generate_employee_code',
      'emit_employee_outbox_event'
  )
ORDER BY schema_name, p.proname;

-- 2D. Verify triggers on leave_requests, audit_logs, and employees + RLS policies
SELECT c.relname AS table_name, t.tgname AS trigger_name, t.tgenabled, pg_get_triggerdef(t.oid) AS def
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND n.nspname = 'public'
  AND c.relname IN ('leave_requests', 'audit_logs', 'employees')
ORDER BY c.relname, t.tgname;

SELECT policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'leave_requests'
ORDER BY policyname;

-- 2E. Verify employee code sequence bounds
SELECT sequencename, max_value, cycle_option
FROM pg_sequences
WHERE schemaname = 'public' AND sequencename = 'seq_branch_a_employee_code';

-- ============================================================================
-- STAGE 3 — POST-CENTRAL-SEED CHECKS
-- [Target: nexus-central | wcmevigbqsmzsdqidjel]
-- ============================================================================
SELECT id, code, name, timezone, is_active
FROM public.branches
WHERE id = '00000000-0000-0000-0000-000000000001'::uuid
   OR code = 'BRANCH-A';

-- ============================================================================
-- STAGE 4 — CROSS-DATABASE IDENTITY CONSISTENCY CHECKS
-- ============================================================================
-- [Target: nexus-central | wcmevigbqsmzsdqidjel]
SELECT id, code, name, timezone, is_active FROM public.branches WHERE code = 'BRANCH-A';

-- [Target: nexus-branch-a | uneycmbqqpkifwhwzbes]
SELECT id, branch_code, branch_name, operating_timezone, is_active FROM public.branch_config;
