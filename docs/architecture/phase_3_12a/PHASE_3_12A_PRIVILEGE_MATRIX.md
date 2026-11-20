# NEXUS HR — PHASE 3.12A: BRANCH A PRIVILEGE & RLS INVENTORY MATRIX

**Target Database:** `nexus-branch-a` (`uneycmbqqpkifwhwzbes` | PostgreSQL 17.11)  
**Audit Method:** Live read-only catalog inspection (`pg_proc`, `information_schema.routine_privileges`, `information_schema.role_table_grants`, `pg_policies`, `pg_trigger`, `pg_roles`).  
**Mode:** READ-ONLY INVENTORY (No privileges were altered during Phase 3.12A).

---

## 1. ROLE CAPABILITIES SUMMARY (OBSERVED)

| Role | `rolsuper` | `rolbypassrls` | `rolcanlogin` | Intended Use |
| :--- | :---: | :---: | :---: | :--- |
| `postgres` | `false` | `true` | `true` | Database owner / migration & `SECURITY DEFINER` owner |
| `authenticator` | `false` | `false` | `true` | PostgREST connection pooler (`SET LOCAL ROLE` to target role) |
| `service_role` | `false` | **`true`** | `false` | Sync Worker & Gateway PostgREST transport (bypasses RLS; **cannot** access revoked schemas like `nexus_internal`) |
| `authenticated` | `false` | `false` | `false` | Verified end-user PostgREST role (subject to RLS) |
| `anon` | `false` | `false` | `false` | Unauthenticated PostgREST role (zero application write/read access) |

---

## 2. PUBLIC FUNCTIONS INVENTORY (ALL 16 EXISTING FUNCTIONS + 3 NEW REMEDIATION V2.6 FUNCTIONS)

### 2.1 Existing Functions Observed on `uneycmbqqpkifwhwzbes`

| Function Signature (`public.*`) | Security Mode | Owner | `search_path` Config | Trigger / Caller | Current `EXECUTE` Grants (Observed) | Risk Analysis | Remediation v2.6 Target Grants |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `claim_outbox_batch(character varying, integer)` | `SECURITY DEFINER` | `postgres` | `public, pg_temp` | Sync Worker (RPC) | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | **HIGH:** Any `anon` or user can claim/lock outbox jobs. | **REVOKE** `PUBLIC, anon, authenticated`; **GRANT** to `service_role` ONLY. |
| `mark_outbox_published(uuid, character varying)` | `SECURITY DEFINER` | `postgres` | `public, pg_temp` | Sync Worker (RPC) | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | **HIGH:** Any `anon` or user can falsely mark events published. | **REVOKE** `PUBLIC, anon, authenticated`; **GRANT** to `service_role` ONLY. |
| `mark_outbox_failed(uuid, character varying, text)` | `SECURITY DEFINER` | `postgres` | `public, pg_temp` | Sync Worker (RPC) | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | **HIGH:** Any `anon` or user can stall outbox retries. | **REVOKE** `PUBLIC, anon, authenticated`; **GRANT** to `service_role` ONLY. |
| `recalculate_attendance_summary(date)` | `SECURITY DEFINER` | `postgres` | `public, pg_temp` | Trigger functions (`emit_*_summary_outbox_event`) | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | **MEDIUM-HIGH:** Exposed via `/rpc/recalculate_attendance_summary`; allows outbox spam. | **REVOKE** `PUBLIC, anon, authenticated, service_role` (called internally by `SECURITY DEFINER` triggers owned by `postgres`). |
| `record_branch_audit_log()` | `SECURITY DEFINER` | `postgres` | `public, pg_temp` | Triggers (`trg_audit_*`) | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | Trigger return type blocks direct RPC call; hygiene dictates revoking `PUBLIC`. | **REVOKE** `PUBLIC, anon, authenticated`; retain `postgres` (trigger owner). |
| `emit_employee_outbox_event()` | `SECURITY DEFINER` | `postgres` | `public, pg_temp` | Trigger (`trg_employee_outbox_sync`) | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | Trigger return type; needs deterministic order + fail-fast guard. | **REVOKE** `PUBLIC, anon, authenticated`. |
| `emit_attendance_summary_outbox_event()` | `SECURITY DEFINER` | `postgres` | `public, pg_temp` | Trigger (`trg_attendance_summary_rollup`) | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | Trigger-only internal function. | **REVOKE** `PUBLIC, anon, authenticated`. |
| `emit_leave_summary_outbox_event()` | `SECURITY DEFINER` | `postgres` | `public, pg_temp` | Trigger (`trg_leave_summary_rollup`) | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | Trigger-only internal function. | **REVOKE** `PUBLIC, anon, authenticated`. |
| `emit_schedule_summary_outbox_event()` | `SECURITY DEFINER` | `postgres` | `public, pg_temp` | Trigger (`trg_schedule_summary_rollup`) | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | Trigger-only internal function. | **REVOKE** `PUBLIC, anon, authenticated`. |
| `generate_employee_code()` | `SECURITY INVOKER` | `postgres` | *None (`null`)* | Trigger (`trg_generate_employee_code`) | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | Truncates at $\ge 10,000$; lacks explicit `search_path`. | Set `SET search_path = public, pg_temp`; **REVOKE** `PUBLIC, anon, authenticated`. |
| `prevent_hard_delete_employees()` | `SECURITY INVOKER` | `postgres` | *None (`null`)* | Trigger (`trg_prevent_hard_delete_employees`) | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | Trigger-only internal function. | Set `SET search_path = public, pg_temp`; **REVOKE** `PUBLIC, anon, authenticated`. |
| `prevent_overlapping_leave()` | `SECURITY INVOKER` | `postgres` | *None (`null`)* | Trigger (`trg_prevent_overlapping_leave`) | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | Trigger-only internal function. | Set `SET search_path = public, pg_temp`; **REVOKE** `PUBLIC, anon, authenticated`. |
| `set_updated_at()` | `SECURITY INVOKER` | `postgres` | *None (`null`)* | Triggers (`trg_*_updated_at`) | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | Trigger-only internal function. | Set `SET search_path = public, pg_temp`; **REVOKE** `PUBLIC, anon, authenticated`. |
| `validate_attendance_check_in()` | `SECURITY INVOKER` | `postgres` | *None (`null`)* | Trigger (`trg_validate_attendance_check_in`) | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | Trigger-only internal function. | Set `SET search_path = public, pg_temp`; **REVOKE** `PUBLIC, anon, authenticated`. |
| `get_auth_role()` | `SECURITY INVOKER` (`STABLE`) | `postgres` | *None (`null`)* | RLS Policies + Helpers | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | **FAIL-OPEN RISK:** Defaults to `'EMPLOYEE'` on NULL/error. | Return `NULL` on missing/invalid claim; set `search_path`; **REVOKE** `PUBLIC, anon`; **GRANT** to `authenticated, service_role`. |
| `get_current_employee_id()` | `SECURITY INVOKER` (`STABLE`) | `postgres` | *None (`null`)* | RLS Policies | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | Used inside RLS expressions under caller role. | Set `search_path = public, auth, pg_temp`; **REVOKE** `PUBLIC, anon`; **GRANT** to `authenticated, service_role`. |

### 2.2 New Functions Introduced by Remediation v2.6

| Function Signature | Schema | Security Mode | Owner | `search_path` | Target Grants |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `verify_gateway_actor(...)` | `nexus_internal` | `SECURITY DEFINER` | `postgres` | `nexus_internal, public, extensions, pg_temp` | **NONE** to `PUBLIC, anon, authenticated, service_role` (called strictly by trusted RPCs). |
| `enforce_leave_decision_integrity()` | `public` | `SECURITY DEFINER` | `postgres` | `nexus_internal, public, auth, pg_temp` | **REVOKE** `PUBLIC, anon, authenticated`; trigger-only (`BEFORE UPDATE ON leave_requests`). |
| `rpc_branch_decide_leave_request(...)` | `public` | `SECURITY DEFINER` | `postgres` | `nexus_internal, public, pg_temp` | **REVOKE** `PUBLIC, anon, authenticated`; **GRANT EXECUTE TO `service_role`** ONLY. |
| `rpc_superadmin_update_leave_request(...)` | `public` | `SECURITY DEFINER` | `postgres` | `nexus_internal, public, pg_temp` | **REVOKE** `PUBLIC, anon, authenticated`; **GRANT EXECUTE TO `service_role`** ONLY. |

---

## 3. BRANCH A TRIGGERS INVENTORY (ALL 20 OBSERVED TRIGGERS)

| Table | Trigger Name | Timing | Events | Level | Status | Function | Remediation v2.6 Change |
| :--- | :--- | :--- | :--- | :--- | :---: | :--- | :--- |
| `attendance` | `trg_validate_attendance_check_in` | `BEFORE` | `INSERT` | `ROW` | `O` | `validate_attendance_check_in` | Unchanged |
| `attendance` | `trg_attendance_updated_at` | `BEFORE` | `UPDATE` | `ROW` | `O` | `set_updated_at` | Unchanged |
| `attendance` | `trg_attendance_summary_rollup` | `AFTER` | `INSERT OR UPDATE` | `ROW` | `O` | `emit_attendance_summary_outbox_event` | Unchanged |
| `attendance` | `trg_audit_attendance` | `AFTER` | `INSERT OR UPDATE` | `ROW` | `O` | `record_branch_audit_log` | Function updated to honor `tx_actor_context` |
| `branch_config` | `trg_branch_config_updated_at` | `BEFORE` | `UPDATE` | `ROW` | `O` | `set_updated_at` | Unchanged |
| `departments` | `trg_departments_updated_at` | `BEFORE` | `UPDATE` | `ROW` | `O` | `set_updated_at` | Unchanged |
| `employee_schedules` | `trg_employee_schedules_updated_at` | `BEFORE` | `UPDATE` | `ROW` | `O` | `set_updated_at` | Unchanged |
| `employee_schedules` | `trg_audit_employee_schedules` | `AFTER` | `INSERT OR DELETE OR UPDATE` | `ROW` | `O` | `record_branch_audit_log` | Function updated |
| `employee_schedules` | `trg_schedule_summary_rollup` | `AFTER` | `INSERT OR DELETE OR UPDATE` | `ROW` | `O` | `emit_schedule_summary_outbox_event` | Unchanged |
| `employees` | `trg_employee_outbox_sync` | `BEFORE` | `INSERT OR UPDATE` | `ROW` | `O` | `emit_employee_outbox_event` | **REPLACE** as `trg_03_employees_outbox_sync` |
| `employees` | `trg_employees_updated_at` | `BEFORE` | `UPDATE` | `ROW` | `O` | `set_updated_at` | **REPLACE** as `trg_02_employees_updated_at` |
| `employees` | `trg_generate_employee_code` | `BEFORE` | `INSERT` | `ROW` | `O` | `generate_employee_code` | **REPLACE** as `trg_01_employees_generate_code` |
| `employees` | `trg_prevent_hard_delete_employees` | `BEFORE` | `DELETE` | `ROW` | `O` | `prevent_hard_delete_employees` | Unchanged |
| `employees` | `trg_audit_employees` | `AFTER` | `INSERT OR UPDATE` | `ROW` | `O` | `record_branch_audit_log` | Function updated |
| `leave_requests` | `trg_prevent_overlapping_leave` | `BEFORE` | `INSERT OR UPDATE` | `ROW` | `O` | `prevent_overlapping_leave` | Renamed/kept `trg_03_leave_prevent_overlap` or ordered |
| `leave_requests` | `trg_leave_requests_updated_at` | `BEFORE` | `UPDATE` | `ROW` | `O` | `set_updated_at` | Ordered cleanly |
| `leave_requests` | *(New in v2.6)* `trg_01_enforce_leave_decision` | `BEFORE` | `UPDATE` | `ROW` | `O` | `enforce_leave_decision_integrity` | **ADDED**: Enforces role/self-approval/immutability |
| `leave_requests` | `trg_leave_summary_rollup` | `AFTER` | `INSERT OR UPDATE` | `ROW` | `O` | `emit_leave_summary_outbox_event` | Unchanged |
| `leave_requests` | `trg_audit_leave_requests` | `AFTER` | `INSERT OR UPDATE` | `ROW` | `O` | `record_branch_audit_log` | Function updated |
| `positions` | `trg_positions_updated_at` | `BEFORE` | `UPDATE` | `ROW` | `O` | `set_updated_at` | Unchanged |
| `shifts` | `trg_shifts_updated_at` | `BEFORE` | `UPDATE` | `ROW` | `O` | `set_updated_at` | Unchanged |

---

## 4. TABLE PRIVILEGES & RLS MATRIX (FOCUS ON `leave_requests` & RELATED TABLES)

### 4.1 Observed Table Grants vs Least-Privilege Target

| Table | Observed `anon` Grants | Observed `authenticated` Grants | RLS Enabled (`relrowsecurity`) | Remediation v2.6 Target Table Grants |
| :--- | :--- | :--- | :---: | :--- |
| `leave_requests` | `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE` | `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE` | `TRUE` | `REVOKE ALL ON leave_requests FROM PUBLIC, anon;` `REVOKE TRUNCATE, DELETE, UPDATE ON leave_requests FROM authenticated;` (Keep `SELECT, INSERT` for `authenticated`; `UPDATE` via Gateway RPC only!) |
| `employees` | `INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE` | `INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE` | `TRUE` | `REVOKE ALL ON employees FROM PUBLIC, anon;` `REVOKE TRUNCATE, DELETE ON employees FROM authenticated;` |
| `audit_logs` | `INSERT, REFERENCES, SELECT, TRIGGER` | `INSERT, REFERENCES, SELECT, TRIGGER` | `TRUE` | `REVOKE ALL ON audit_logs FROM PUBLIC, anon;` `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_logs FROM authenticated;` (Inserted solely by `SECURITY DEFINER` audit trigger!) |
| `sync_outbox` | *None* | *None* | `TRUE` | Already isolated to `postgres` and `service_role`! |
| All other operational tables (`attendance`, `branch_config`, `departments`, `employee_schedules`, `positions`, `shifts`) | Includes `TRUNCATE` + DML | Includes `TRUNCATE` + DML | `TRUE` | `REVOKE ALL ON ... FROM PUBLIC, anon;` `REVOKE TRUNCATE ON ... FROM authenticated;` |
| `nexus_internal.*` (v2.6 private tables) | N/A | N/A | N/A | **Zero privileges** to `PUBLIC, anon, authenticated, service_role` (owner `postgres` only). |

### 4.2 Existing RLS Policies on `leave_requests`, `employees`, `audit_logs` (Observed)

| Table | Policy Name | Roles | Command | Current Expression (`qual` / `with_check`) | Security Defect & v2.6 Fix |
| :--- | :--- | :--- | :---: | :--- | :--- |
| `leave_requests` | `leave_select` | `authenticated` | `SELECT` | `(employee_id = get_current_employee_id()) OR (get_auth_role() = ANY (ARRAY['BRANCH_HR','BRANCH_MANAGER','SUPERADMIN']))` | OK once `get_auth_role()` fails closed (`NULL`). |
| `leave_requests` | `leave_self_submit` | `authenticated` | `INSERT` | `WITH CHECK ((employee_id = get_current_employee_id()) AND ((status)::text = 'PENDING'::text))` | OK once `get_current_employee_id()` fails closed. |
| `leave_requests` | `leave_manager_decide` | `authenticated` | `UPDATE` | `USING (get_auth_role() = ANY (['BRANCH_MANAGER','SUPERADMIN']))` / `WITH CHECK (status = ANY (['APPROVED','REJECTED']))` | **DEFECTS:** Permits self-approval, non-PENDING updates, field tampering, and constrains SUPERADMIN `WITH CHECK`. **FIX:** Drop permissive policy; revoke `UPDATE` on `leave_requests` from `authenticated` (all updates via Gateway RPC) OR restrict to hardened split policies + enforce via trigger. |
| `audit_logs` | `audit_logs_select` | `authenticated` | `SELECT` | `get_auth_role() = ANY (['BRANCH_MANAGER','SUPERADMIN'])` | OK once `get_auth_role()` returns `NULL` on missing claim. |

---

## 5. LEAST-PRIVILEGE MATRIX BY ACTOR / SERVICE COMPONENT

| Component / Identity | Credential Used | Can `claim_outbox_batch`? | Can Read `nexus_internal.gateway_signing_keys`? | Can Directly `UPDATE leave_requests`? | Can Execute `rpc_branch_decide_leave_request`? |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Anonymous Client (`anon`)** | Branch A Anon Key | **NO** (Revoked) | **NO** | **NO** (Revoked + RLS) | **NO** (Revoked) |
| **Logged-in User (`authenticated`)** | Branch A User JWT (if issued) | **NO** (Revoked) | **NO** | **NO** (Revoked; RPC-only) | **NO** (Revoked) |
| **Sync Worker** | `SUPABASE_BRANCH_A_SERVICE_ROLE_KEY` | **YES** | **NO** (Schema revoked) | **BLOCKED** (Trigger fails closed without `tx_actor_context`) | **BLOCKED** (Fails HMAC signature verification) |
| **Backend API Gateway** | `SUPABASE_BRANCH_A_SERVICE_ROLE_KEY` + `GATEWAY_ACTOR_HMAC_KEY` | *(Unused by Gateway)* | *(Holds matching HMAC secret)* | **BLOCKED** (Must call verified RPC) | **YES** (Validates Central JWT + Central `user_profiles` + HMAC + Nonce) |
| **Database Trigger (`postgres` owner)** | `SECURITY DEFINER` context | Internal only (`recalculate_attendance_summary`) | **YES** (Internal verification) | Via verified RPC transaction only | Internal trigger enforcement |
