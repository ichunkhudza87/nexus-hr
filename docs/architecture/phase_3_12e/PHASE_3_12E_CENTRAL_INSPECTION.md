# Phase 3.12E — Central (`nexus-central`) Read-Only Inspection

**Project:** `nexus-central`  
**Ref:** `wcmevigbqsmzsdqidjel`  
**Host:** `db.wcmevigbqsmzsdqidjel.supabase.co`  
**PostgreSQL:** `PostgreSQL 17.11 on x86_64-pc-linux-gnu` (`17.11.0.018`)  
**Status:** `ACTIVE_HEALTHY` (`ap-southeast-1`)

---

## 1. Verified Database Facts

- **Schemas:** `auth, extensions, graphql, graphql_public, public, realtime, storage, vault` (`nexus_internal` absent).
- **Extensions:** `pg_stat_statements (1.11)`, `pgcrypto (1.3)`, `plpgsql (1.0)`, `supabase_vault (0.3.1)`, `uuid-ossp (1.1)`.
- **Application Tables (7/7 present, RLS enabled on all 7, `relforcerowsecurity = false`):**
  1. `attendance_daily_summaries` (12 cols)
  2. `audit_logs` (12 cols)
  3. `branches` (9 cols)
  4. `employee_directory` (14 cols)
  5. `sync_inbox` (17 cols)
  6. `sync_runs` (10 cols)
  7. `user_profiles` (9 cols)
- **Constraints & Indexes:** 28 constraints (PK, FK, UNIQUE, CHECK) and 29 indexes verified intact.
- **Functions (7/7 present, owner = `postgres`):**
  - `apply_inbox_event_projection(uuid)` (`SECURITY DEFINER`, `search_path=public, pg_temp`)
  - `claim_inbox_batch(varchar, integer)` (`SECURITY DEFINER`, `search_path=public, pg_temp`)
  - `get_auth_branch_id()` (invoker)
  - `get_auth_role()` (invoker)
  - `handle_new_auth_user()` (`SECURITY DEFINER`, `search_path=public, pg_temp`)
  - `record_central_audit_log()` (`SECURITY DEFINER`, `search_path=public, pg_temp`)
  - `set_updated_at()` (invoker)
  - Note: All 7 functions currently have `EXECUTE` granted to `public`, `anon`, `authenticated`, `service_role`.
- **Triggers in `public` (6):** `trg_att_summary_updated_at`, `trg_audit_branches`, `trg_branches_updated_at`, `trg_employee_directory_updated_at`, `trg_audit_user_profiles`, `trg_user_profiles_updated_at` (all enabled `'O'`). *(7th baseline trigger `on_auth_user_created` resides on `auth.users`.)*
- **RLS Policies (9):** All 9 baseline policies present.
- **`branches` Seed State & Conflicts (`E-02`):**
  - `public.branches`: **0 rows**.
  - UUID `00000000-0000-0000-0000-000000000001` conflict: **None**.
  - Code `'BRANCH-A'` conflict: **None**.
- **Rollback Child Table Row Counts:**
  - `employee_directory`: `0` (Branch A: `0`)
  - `attendance_daily_summaries`: `0` (Branch A: `0`)
  - `user_profiles`: `0` (Branch A: `0`)
  - `audit_logs`: `0` (Branch A: `0`)
