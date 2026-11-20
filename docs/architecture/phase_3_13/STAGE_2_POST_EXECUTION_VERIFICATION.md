# NEXUS HR — PHASE 3.13 STAGE 2 POST-EXECUTION VERIFICATION

**Target Project:** `nexus-branch-a` (`uneycmbqqpkifwhwzbes`)  
**Migration Verified:** `supabase/remediation/v2.7.1/001_branch_a_security_remediation_v2_7_1.sql`  
**Verification Mode:** Read-Only SQL Inspection (`supabase_mcp:execute_sql`)  
**Timestamp:** `2026-11-12T22:26:32+07:00` to `2026-11-12T22:27:04+07:00`  
**Final Classification:** **`STAGE 2 VERIFIED — READY FOR STAGE 3`**

---

## Check 1 — `nexus_internal` Schema & Privileges

**SQL Query Used:**
```sql
SELECT
  n.nspname AS schema_name,
  pg_get_userbyid(n.nspowner) AS schema_owner,
  has_schema_privilege('anon', 'nexus_internal', 'USAGE') AS anon_usage,
  has_schema_privilege('authenticated', 'nexus_internal', 'USAGE') AS auth_usage,
  has_schema_privilege('service_role', 'nexus_internal', 'USAGE') AS svc_usage
FROM pg_namespace n
WHERE n.nspname = 'nexus_internal';
```

**Actual Result:**
```json
[{"schema_name":"nexus_internal","schema_owner":"postgres","anon_usage":false,"auth_usage":false,"svc_usage":false}]
```

**Expected Result:** `nexus_internal` exists, owned by `postgres`, with `USAGE` denied (`false`) to `anon`, `authenticated`, and `service_role`.

**Status:** **PASS**

---

## Check 2 — `nexus_internal` Tables & Inaccessibility

**SQL Query Used:**
```sql
SELECT
  c.relname AS table_name,
  has_table_privilege('anon', 'nexus_internal.' || c.relname, 'SELECT') AS anon_sel,
  has_table_privilege('authenticated', 'nexus_internal.' || c.relname, 'SELECT') AS auth_sel,
  has_table_privilege('service_role', 'nexus_internal.' || c.relname, 'SELECT') AS svc_sel,
  has_table_privilege('service_role', 'nexus_internal.' || c.relname, 'INSERT') AS svc_ins
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'nexus_internal' AND c.relkind = 'r'
ORDER BY c.relname;
```

**Actual Result:**
```json
[
  {"table_name":"gateway_signing_keys","anon_sel":false,"auth_sel":false,"svc_sel":false,"svc_ins":false},
  {"table_name":"tx_actor_context","anon_sel":false,"auth_sel":false,"svc_sel":false,"svc_ins":false},
  {"table_name":"used_actor_nonces","anon_sel":false,"auth_sel":false,"svc_sel":false,"svc_ins":false}
]
```

**Expected Result:** All three internal tables (`gateway_signing_keys`, `tx_actor_context`, `used_actor_nonces`) exist and are inaccessible to `anon`, `authenticated`, and `service_role`.

**Status:** **PASS**

---

## Check 3 — Internal & Gateway RPC Functions + EXECUTE Privileges

**SQL Query Used:**
```sql
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args,
  p.prosecdef AS is_security_definer,
  pg_get_userbyid(p.proowner) AS owner,
  has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_exec
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE (n.nspname = 'nexus_internal' AND p.proname IN ('verify_gateway_actor', 'cleanup_expired_actor_nonces'))
   OR (n.nspname = 'public' AND p.proname IN ('rpc_branch_decide_leave_request', 'rpc_superadmin_update_leave_request'))
ORDER BY n.nspname, p.proname;
```

**Actual Result:**
```json
[
  {"schema_name":"nexus_internal","function_name":"cleanup_expired_actor_nonces","args":"p_batch_size integer","is_security_definer":true,"owner":"postgres","public_exec":false,"anon_exec":false,"auth_exec":false,"svc_exec":false},
  {"schema_name":"nexus_internal","function_name":"verify_gateway_actor","args":"p_key_id text, p_action_scope text, p_target_id uuid, p_operation_mode text, p_actor_user_id uuid, p_actor_email text, p_actor_role text, p_branch_id uuid, p_employee_id uuid, p_exp bigint, p_nonce uuid, p_actor_sig text","is_security_definer":true,"owner":"postgres","public_exec":false,"anon_exec":false,"auth_exec":false,"svc_exec":false},
  {"schema_name":"public","function_name":"rpc_branch_decide_leave_request","args":"p_key_id text, p_request_id uuid, p_decision character varying, p_rejection_reason text, p_actor_user_id uuid, p_actor_email text, p_actor_role text, p_branch_id uuid, p_employee_id uuid, p_exp bigint, p_nonce uuid, p_actor_sig text","is_security_definer":true,"owner":"postgres","public_exec":false,"anon_exec":false,"auth_exec":false,"svc_exec":true},
  {"schema_name":"public","function_name":"rpc_superadmin_update_leave_request","args":"p_key_id text, p_request_id uuid, p_operation_mode text, p_employee_id uuid, p_leave_type character varying, p_start_date date, p_end_date date, p_total_days numeric, p_reason text, p_status character varying, p_rejection_reason text, p_approved_by uuid, p_approved_at timestamp with time zone, p_set_rejection_reason boolean, p_set_approved_by boolean, p_set_approved_at boolean, p_actor_user_id uuid, p_actor_email text, p_actor_role text, p_branch_id uuid, p_actor_employee_id uuid, p_exp bigint, p_nonce uuid, p_actor_sig text","is_security_definer":true,"owner":"postgres","public_exec":false,"anon_exec":false,"auth_exec":false,"svc_exec":true}
]
```

**Expected Result:** All four functions exist as `SECURITY DEFINER` owned by `postgres`; internal functions deny `EXECUTE` to all application roles (`false`); Gateway RPCs grant `EXECUTE` only to `service_role` (`true`) and deny `PUBLIC`, `anon`, and `authenticated` (`false`).

**Status:** **PASS**

---

## Check 4 — Effective Table Privileges (`public.leave_requests` & `public.audit_logs`)

**SQL Query Used:**
```sql
SELECT
  t.tbl,
  r.rol,
  has_table_privilege(r.rol, t.tbl, 'SELECT') AS sel,
  has_table_privilege(r.rol, t.tbl, 'INSERT') AS ins,
  has_table_privilege(r.rol, t.tbl, 'UPDATE') AS upd,
  has_table_privilege(r.rol, t.tbl, 'DELETE') AS del,
  has_table_privilege(r.rol, t.tbl, 'TRUNCATE') AS trunc
FROM (VALUES ('public.leave_requests'), ('public.audit_logs')) AS t(tbl)
CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rol)
ORDER BY t.tbl, r.rol;
```

**Actual Result:**
```json
[
  {"tbl":"public.audit_logs","rol":"anon","sel":false,"ins":false,"upd":false,"del":false,"trunc":false},
  {"tbl":"public.audit_logs","rol":"authenticated","sel":true,"ins":false,"upd":false,"del":false,"trunc":false},
  {"tbl":"public.audit_logs","rol":"service_role","sel":true,"ins":false,"upd":false,"del":false,"trunc":false},
  {"tbl":"public.leave_requests","rol":"anon","sel":false,"ins":false,"upd":false,"del":false,"trunc":false},
  {"tbl":"public.leave_requests","rol":"authenticated","sel":true,"ins":true,"upd":false,"del":false,"trunc":false},
  {"tbl":"public.leave_requests","rol":"service_role","sel":true,"ins":false,"upd":false,"del":false,"trunc":false}
]
```

**Expected Result:**
- `service_role` has `SELECT` only (no `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`) on `leave_requests` and `audit_logs`.
- `authenticated` has no `UPDATE`/`DELETE`/`TRUNCATE` on `leave_requests`, and `SELECT` only on `audit_logs`.
- `anon` has no privileges on either table.

**Status:** **PASS**

---

## Check 5 — Triggers & Employee Trigger Ordering

**SQL Query Used:**
```sql
SELECT
  c.relname AS table_name,
  t.tgname AS trigger_name,
  pg_get_triggerdef(t.oid) AS trigger_def
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('leave_requests', 'audit_logs', 'employees')
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;
```

**Actual Result:**
- `audit_logs`:
  - `trg_01_prevent_truncate_audit_logs` (`BEFORE TRUNCATE ... prevent_truncate_protected_tables()`)
- `employees` (in alphabetical firing order):
  1. `trg_01_employees_generate_code` (`BEFORE INSERT ... generate_employee_code()`)
  2. `trg_02_employees_updated_at` (`BEFORE UPDATE ... set_updated_at()`)
  3. `trg_03_employees_outbox_sync` (`BEFORE INSERT OR UPDATE ... emit_employee_outbox_event()`)
  4. `trg_audit_employees` (`AFTER INSERT OR UPDATE ... record_branch_audit_log()`)
  5. `trg_prevent_hard_delete_employees` (`BEFORE DELETE ... prevent_hard_delete_employees()`)
- `leave_requests`:
  - `trg_01_enforce_leave_decision` (`BEFORE UPDATE ... enforce_leave_decision_integrity()`)
  - `trg_02_leave_requests_updated_at` (`BEFORE UPDATE ... set_updated_at()`)
  - `trg_03_prevent_overlapping_leave` (`BEFORE INSERT OR UPDATE ... prevent_overlapping_leave()`)
  - `trg_04_prevent_delete_leave_requests` (`BEFORE DELETE ... prevent_hard_delete_leave_requests()`)
  - `trg_05_prevent_truncate_leave_requests` (`BEFORE TRUNCATE ... prevent_truncate_protected_tables()`)
  - `trg_audit_leave_requests` (`AFTER INSERT OR DELETE OR UPDATE ... record_branch_audit_log()`)
  - `trg_leave_summary_rollup` (`AFTER INSERT OR UPDATE ... emit_leave_summary_outbox_event()`)

**Expected Result:** All decision, audit (`INSERT`/`UPDATE`/`DELETE`), `DELETE`/`TRUNCATE` guards, and ordered `employees` triggers (`trg_01` → `trg_02` → `trg_03`) are present.

**Status:** **PASS**

---

## Check 6 — `tx_actor_context.key_id` & `gateway_signing_keys` Structure

**SQL Query Used (Columns):**
```sql
SELECT
  table_name,
  column_name,
  data_type,
  character_maximum_length,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'nexus_internal'
  AND (table_name = 'gateway_signing_keys' OR (table_name = 'tx_actor_context' AND column_name = 'key_id'))
ORDER BY table_name, ordinal_position;
```

**SQL Query Used (Signing Key Constraints):**
```sql
SELECT
  conname AS constraint_name,
  contype AS constraint_type,
  pg_get_constraintdef(oid) AS constraint_def
FROM pg_constraint
WHERE conrelid = 'nexus_internal.gateway_signing_keys'::regclass
ORDER BY conname;
```

**Actual Result:**
- `tx_actor_context.key_id`: `character varying(64)`, `is_nullable = 'NO'`
- `gateway_signing_keys` columns: `key_id` (`varchar(64) NOT NULL`), `hmac_secret` (`text NOT NULL`), `is_active` (`boolean NOT NULL DEFAULT true`), `activated_at` (`timestamptz NOT NULL DEFAULT now()`), `created_at` (`timestamptz NOT NULL DEFAULT now()`), `rotated_at` (`timestamptz`), `expires_at` (`timestamptz`), `revoked_at` (`timestamptz`)
- `gateway_signing_keys` constraints:
  - `gateway_signing_keys_pkey`: `PRIMARY KEY (key_id)`
  - `chk_gateway_signing_key_id_format`: `CHECK (((key_id)::text ~ '^[A-Za-z0-9._-]{1,64}$'::text))`
  - `chk_gateway_signing_key_secret_len`: `CHECK ((octet_length(hmac_secret) >= 32))`
  - `chk_gateway_signing_key_state`: `CHECK (((revoked_at IS NULL) OR (is_active = false)))`

**Expected Result:** `tx_actor_context.key_id` is `VARCHAR(64) NOT NULL`; `gateway_signing_keys` matches v2.7.1 structure and key validation constraints (empty table acceptable at this stage).

**Status:** **PASS**

---

## Check 7 — `branch_config`, Employee Sequence, & Application Data Counts

**SQL Query Used:**
```sql
SELECT
  (SELECT is_active FROM public.branch_config WHERE id = '00000000-0000-0000-0000-000000000001'::uuid) AS branch_is_active,
  (SELECT max_value FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'seq_branch_a_employee_code') AS seq_max_value,
  (SELECT cycle FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'seq_branch_a_employee_code') AS seq_cycle,
  (SELECT count(*) FROM public.employees) AS employees_cnt,
  (SELECT count(*) FROM public.leave_requests) AS leave_requests_cnt,
  (SELECT count(*) FROM public.audit_logs) AS audit_logs_cnt,
  (SELECT count(*) FROM nexus_internal.gateway_signing_keys) AS signing_keys_cnt;
```

**Actual Result:**
```json
[{"branch_is_active":true,"seq_max_value":999999999999,"seq_cycle":false,"employees_cnt":0,"leave_requests_cnt":0,"audit_logs_cnt":0,"signing_keys_cnt":0}]
```

**Expected Result:** `branch_config.is_active = TRUE`, `seq_branch_a_employee_code` has `max_value = 999999999999` and `cycle = false`, and application tables remain unmodified (`0` rows).

**Status:** **PASS**

---

## Check 8 — RLS Enabled on All Public Tables & `leave_requests` Policies

**SQL Query Used (RLS Status):**
```sql
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;
```

**SQL Query Used (`leave_requests` Policies):**
```sql
SELECT
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'leave_requests'
ORDER BY policyname;
```

**Actual Result:**
- All 10 `public` tables (`attendance`, `audit_logs`, `branch_config`, `departments`, `employee_schedules`, `employees`, `leave_requests`, `positions`, `shifts`, `sync_outbox`) have `rls_enabled = true`.
- `leave_requests` policies:
  - `leave_deny_direct_update` (`RESTRICTIVE`, `{authenticated}`, `UPDATE`)
  - `leave_select` (`PERMISSIVE`, `{authenticated}`, `SELECT`)
  - `leave_self_submit` (`PERMISSIVE`, `{authenticated}`, `INSERT`)
  - Legacy `leave_manager_decide` and `leave_superadmin_manage` policies are removed.

**Expected Result:** RLS enabled on all public tables; `leave_requests` direct `UPDATE` denied to `authenticated` via restrictive policy; legacy permissive update policies removed.

**Status:** **PASS**

---

## Final Determination

**`STAGE 2 VERIFIED — READY FOR STAGE 3`**
