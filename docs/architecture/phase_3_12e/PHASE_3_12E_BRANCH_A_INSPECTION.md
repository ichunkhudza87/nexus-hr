# Phase 3.12E — Branch A (`nexus-branch-a`) Read-Only Inspection

**Project:** `nexus-branch-a`  
**Ref:** `uneycmbqqpkifwhwzbes`  
**Host:** `db.uneycmbqqpkifwhwzbes.supabase.co`  
**PostgreSQL:** `PostgreSQL 17.11 on x86_64-pc-linux-gnu` (`17.11.0.018`)  
**Status:** `ACTIVE_HEALTHY` (`ap-southeast-1`)

---

## 1. Verified Database Facts

- **Schemas:** `auth, extensions, graphql, graphql_public, public, realtime, storage, vault` (`nexus_internal` **does not exist** — no partial remediation objects present).
- **Extensions:** `pg_stat_statements (1.11)`, `pgcrypto (1.3)`, `plpgsql (1.0)`, `supabase_vault (0.3.1)`, `uuid-ossp (1.1)`.
- **Application Tables (10/10 present, RLS enabled on all 10, `relforcerowsecurity = false`):**
  - `attendance` (17 cols), `audit_logs` (12 cols), `branch_config` (7 cols), `departments` (7 cols), `employee_schedules` (9 cols), `employees` (17 cols), `leave_requests` (14 cols), `positions` (8 cols), `shifts` (10 cols), `sync_outbox` (15 cols).
- **Constraints & Indexes:** 47 constraints and 42 indexes in `public`.
- **Sequences:** `public.seq_branch_a_employee_code` (`last_value = null`, `increment_by = 1`, `cycle = false`, `max_value = 9223372036854776000`).
- **Functions (16/16 baseline present, owner = `postgres`):** All 16 baseline functions exist; currently all have `EXECUTE` granted to `public`, `anon`, `authenticated`, `service_role`.
- **Triggers (20/20 baseline present, all enabled `'O'`):** Includes `trg_audit_leave_requests` (`AFTER INSERT OR UPDATE` only), `trg_employee_outbox_sync`, `trg_generate_employee_code`, `trg_employees_updated_at`.
- **RLS Policies (20):** Includes legacy `leave_manager_decide` (`PERMISSIVE`, `UPDATE` on `leave_requests`).
- **Baseline Table Privileges (`E-03`):**
  - `public.leave_requests`: `anon`, `authenticated`, and `service_role` all currently hold `INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER`.
  - `public.audit_logs`: `anon` & `authenticated` hold `INSERT, SELECT, REFERENCES, TRIGGER`; `service_role` holds `ALL`.
- **`branch_config` Singleton (`E-01`):**
  - Row count: `1`
  - Values: `id = 00000000-0000-0000-0000-000000000001`, `branch_code = 'BRANCH-A'`, `branch_name = 'Branch A - Jakarta'`, `operating_timezone = 'Asia/Jakarta'`, `max_overtime_hours_per_day = 4`, `attendance_grace_period_mins = 15`.
  - **Missing Column:** `is_active` does **NOT** exist on `public.branch_config`!
- **Row Counts (Zero Sensitive Data Exposed):**
  - `employees`: `0`
  - `leave_requests`: `0`
  - `audit_logs`: `0`
  - `sync_outbox`: `0`
  - `nexus_internal.*`: N/A (schema not yet created)
