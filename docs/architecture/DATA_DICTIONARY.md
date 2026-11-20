# NEXUS HR — Comprehensive Data Dictionary

**System:** NEXUS HR Multi-Branch Distributed Database System  
**Revision:** 2.0.0 (Comprehensive Architecture Revision)  
**Standard Timestamp Strategy:** `TIMESTAMPTZ` (Stored in UTC, Displayed in `Asia/Jakarta` / UTC+7)  
**Primary Key Standard:** UUIDv4 (`gen_random_uuid()`)  
**Workspace:** `D:\Antigravity_Projects\nexus-hr`  

---

# SECTION 1: NODE 1 — CENTRAL DATABASE (`nexus-central`)

**Project Ref:** `wcmevigbqsmzsdqidjel` | **Host:** `db.wcmevigbqsmzsdqidjel.supabase.co`  
**Engine:** PostgreSQL 17 | **Table Count:** **7 Application Tables**  
**Authority:** Global branch registry, user identities (Supabase Auth IdP), user profiles, consolidated reporting, and cross-branch employee directory projection.

---

### 1.1 `branches`
*Master authority for physical company branches.*
- **Authoritative Master:** `nexus-central`
- **Synchronization Direction:** Static Central authority. Initialized to Branch A via local `branch_config` provisioning.

| Column Name | Data Type | Nullable | Default | Constraints | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | `PRIMARY KEY` | Unique internal branch identifier. |
| `code` | `VARCHAR(20)` | No | None | `UNIQUE`, `CHECK (code ~ '^[A-Z0-9\-_]+$')` | Unique uppercase branch code (e.g., `'BRANCH-A'`). |
| `name` | `VARCHAR(100)` | No | None | None | Official branch operational name. |
| `timezone` | `VARCHAR(50)` | No | `'Asia/Jakarta'` | None | IANA canonical timezone for the branch facility. |
| `address` | `TEXT` | Yes | `NULL` | None | Physical address of the branch facility. |
| `phone_number` | `VARCHAR(50)` | Yes | `NULL` | None | Official contact telephone number. |
| `is_active` | `BOOLEAN` | No | `TRUE` | None | Operational flag indicating active branch status. |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | None | Record creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | No | `now()` | None | Timestamp of last record modification. |

- **Indexes:**
  - `idx_branches_code`: `UNIQUE btree (code)`
  - `idx_branches_is_active`: `btree (is_active)`
- **RLS Summary:** Publicly readable by all authenticated users; mutations restricted to `SUPERADMIN`.

---

### 1.2 `user_profiles`
*Application user identity profile mapped to Central Supabase Auth.*
- **Authoritative Master:** `nexus-central`
- **Synchronization Direction:** Central Master. Validated cross-node via Central JWT signature.

| Column Name | Data Type | Nullable | Default | Constraints | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `UUID` | No | None | `PRIMARY KEY`, `REFERENCES auth.users(id) ON DELETE CASCADE` | Matches the Supabase Auth user UUID. |
| `email` | `VARCHAR(255)` | No | None | `UNIQUE` | User login email address (synced from `auth.users`). |
| `full_name` | `VARCHAR(150)` | No | None | None | User's full legal name. |
| `role` | `VARCHAR(50)` | No | `'EMPLOYEE'` | `CHECK (role IN ('SUPERADMIN', 'CENTRAL_HR', 'BRANCH_MANAGER', 'BRANCH_HR', 'EMPLOYEE'))` | Application authorization role. |
| `branch_id` | `UUID` | Yes | `NULL` | `REFERENCES branches(id) ON DELETE SET NULL` | Assigned branch (required for branch roles, NULL for corporate). |
| `avatar_url` | `TEXT` | Yes | `NULL` | None | URL to profile avatar image. |
| `is_active` | `BOOLEAN` | No | `TRUE` | None | Flag indicating if user account is authorized. |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | None | Record creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | No | `now()` | None | Record update timestamp. |

- **Indexes:**
  - `idx_user_profiles_email`: `UNIQUE btree (email)`
  - `idx_user_profiles_role`: `btree (role)`
  - `idx_user_profiles_branch_id`: `btree (branch_id)`
- **RLS Summary:** Users read own profile; `SUPERADMIN`/`CENTRAL_HR` read all; mutations restricted to `SUPERADMIN` (or user for avatar).

---

### 1.3 `employee_directory`
*Centralized read-optimized projection of employee records across all branches.*
- **Authoritative Master:** `nexus-branch-a` (for Branch A personnel)
- **Synchronization Direction:** Branch A $\rightarrow$ Central (via `sync_inbox` materialization).

| Column Name | Data Type | Nullable | Default | Constraints | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `UUID` | No | None | `PRIMARY KEY` | Global employee ID (matches `nexus-branch-a.employees.id`). |
| `branch_id` | `UUID` | No | None | `REFERENCES branches(id) ON DELETE RESTRICT` | Central branch foreign key. |
| `employee_code` | `VARCHAR(50)` | No | None | None | Branch-assigned employee code (e.g. `'EMP-A-0001'`). |
| `full_name` | `VARCHAR(150)` | No | None | None | Employee full legal name. |
| `email` | `VARCHAR(255)` | Yes | `NULL` | None | Corporate email address. |
| `department_name`| `VARCHAR(100)` | Yes | `NULL` | None | Denormalized current department name. |
| `position_title` | `VARCHAR(100)` | Yes | `NULL` | None | Denormalized current job title. |
| `employment_status`| `VARCHAR(50)` | No | `'PERMANENT'` | `CHECK (employment_status IN ('PERMANENT', 'CONTRACT', 'INTERN', 'PROBATION'))` | Contract classification. |
| `join_date` | `DATE` | No | None | None | Employment start date. |
| `is_active` | `BOOLEAN` | No | `TRUE` | None | Active employee status flag. |
| `last_synced_at` | `TIMESTAMPTZ` | No | `now()` | None | Timestamp of last sync projection update. |
| `version` | `BIGINT` | No | `1` | None | Monotonically increasing aggregate version from branch. |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | None | Record creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | No | `now()` | None | Record update timestamp. |

- **Constraints & Indexes:**
  - `uq_emp_dir_branch_code`: `UNIQUE (branch_id, employee_code)`
  - `idx_emp_dir_branch_lookup`: `btree (branch_id, employee_code)`
  - `idx_emp_dir_full_name`: `btree (full_name)`
  - `idx_emp_dir_status`: `btree (is_active, employment_status)`
- **Versioning Rule:** UPSERT applies only when `incoming.aggregate_version > employee_directory.version`. Stale events are discarded.
- **RLS Summary:** Read-only for `SUPERADMIN` and `CENTRAL_HR`; mutations restricted exclusively to internal `service_role`.

---

### 1.4 `attendance_daily_summaries`
*Consolidated daily branch attendance aggregates for corporate analytics and compliance.*
- **Authoritative Master:** `nexus-branch-a` (Calculated rollups mastered by Branch A)
- **Synchronization Direction:** Branch A $\rightarrow$ Central (via `sync_inbox` event materialization).

| Column Name | Data Type | Nullable | Default | Constraints | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | `PRIMARY KEY` | Summary record identifier. |
| `branch_id` | `UUID` | No | None | `REFERENCES branches(id) ON DELETE RESTRICT` | Target corporate branch foreign key. |
| `summary_date` | `DATE` | No | None | None | Calendar date of attendance summary. |
| `total_employees` | `INT` | No | `0` | `CHECK (total_employees >= 0)` | Total scheduled/active workforce on that date. |
| `present_count` | `INT` | No | `0` | `CHECK (present_count >= 0)` | Total on-time check-ins. |
| `late_count` | `INT` | No | `0` | `CHECK (late_count >= 0)` | Total late check-ins beyond grace period. |
| `absent_count` | `INT` | No | `0` | `CHECK (absent_count >= 0)` | Scheduled employees with no check-in. |
| `leave_count` | `INT` | No | `0` | `CHECK (leave_count >= 0)` | Employees on approved leave on that date. |
| `last_synced_at`| `TIMESTAMPTZ` | No | `now()` | None | Timestamp when Central received the summary. |
| `source_version`| `BIGINT` | No | `0` | None | Monotonically increasing rollup version from Branch A. |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | None | Record creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | No | `now()` | None | Record update timestamp. |

- **Constraints & Indexes:**
  - `uq_att_summary_branch_date`: `UNIQUE (branch_id, summary_date)`
  - `chk_att_summary_capacity`: `CHECK (present_count + late_count + absent_count + leave_count <= total_employees)`
  - `idx_att_summary_lookup`: `btree (branch_id, summary_date DESC)`
- **Recalculation Rule:** When historical attendance or leave corrections occur on Branch A, Branch A recomputes the day's rollup, increments `source_version`, and dispatches an update. Central applies updates only if `incoming.source_version > existing.source_version`.
- **RLS Summary:** Readable by `SUPERADMIN` and `CENTRAL_HR`; mutations restricted exclusively to `service_role`.

---

### 1.5 `sync_inbox`
*Staging queue ensuring idempotent ingestion of domain events from branch outboxes.*
- **Authoritative Master:** Central System Queue
- **Synchronization Direction:** Ingestion barrier receiving Branch A $\rightarrow$ Central payloads.

| Column Name | Data Type | Nullable | Default | Constraints | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | `PRIMARY KEY` | Internal inbox entry identifier. |
| `event_id` | `UUID` | No | None | `UNIQUE` | Globally unique event identifier emitted from Branch A outbox. |
| `source_node` | `VARCHAR(50)` | No | None | None | Emitting node name (e.g., `'BRANCH_A'`). |
| `event_type` | `VARCHAR(100)` | No | None | None | Domain event type (`'EMPLOYEE_UPSERTED'`, `'ATTENDANCE_SUMMARY_RECORDED'`). |
| `aggregate_type`| `VARCHAR(100)` | No | None | None | Aggregate root category (`'EMPLOYEE'`, `'ATTENDANCE_SUMMARY'`). |
| `aggregate_id` | `UUID` | No | None | None | Identifier of affected domain entity. |
| `aggregate_version`| `BIGINT` | No | `1` | None | Monotonically increasing aggregate sequence number. |
| `schema_version`| `INT` | No | `1` | None | Schema contract version for backward compatibility. |
| `payload` | `JSONB` | No | None | None | Full immutable JSON snapshot of the event. |
| `status` | `VARCHAR(50)` | No | `'RECEIVED'` | `CHECK (status IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD_LETTER'))` | Processing status. |
| `locked_by` | `VARCHAR(100)` | Yes | `NULL` | None | Consumer worker identifier holding claim. |
| `locked_at` | `TIMESTAMPTZ` | Yes | `NULL` | None | Timestamp claim lease was established. |
| `error_message` | `TEXT` | Yes | `NULL` | None | Diagnostic stack trace if processing failed. |
| `retry_count` | `INT` | No | `0` | None | Ingestion retry count. |
| `next_retry_at` | `TIMESTAMPTZ` | Yes | `NULL` | None | Timestamp for next eligible retry attempt. |
| `received_at` | `TIMESTAMPTZ` | No | `now()` | None | Arrival timestamp on Central. |
| `processed_at` | `TIMESTAMPTZ` | Yes | `NULL` | None | Timestamp of successful projection materialization. |

- **Indexes:**
  - `idx_sync_inbox_event_id`: `UNIQUE btree (event_id)`
  - `idx_sync_inbox_processing_queue`: `btree (status, next_retry_at, received_at) WHERE status IN ('RECEIVED', 'FAILED')`
  - `idx_sync_inbox_aggregate`: `btree (aggregate_type, aggregate_id)`
- **RLS Summary:** Restricted exclusively to internal `service_role`.

---

### 1.6 `sync_runs`
*Execution telemetry and diagnostic audit logs for synchronization batches.*
- **Authoritative Master:** Central System Telemetry

| Column Name | Data Type | Nullable | Default | Constraints | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | `PRIMARY KEY` | Batch execution run identifier. |
| `source_node` | `VARCHAR(50)` | No | None | None | Sending node identifier (`'BRANCH_A'`). |
| `target_node` | `VARCHAR(50)` | No | `'CENTRAL'` | None | Receiving node identifier. |
| `batch_size` | `INT` | No | None | `CHECK (batch_size >= 0)` | Total events dispatched in the batch. |
| `events_synced` | `INT` | No | `0` | `CHECK (events_synced >= 0)` | Events successfully ingested into inbox. |
| `events_failed` | `INT` | No | `0` | `CHECK (events_failed >= 0)` | Events failed or dead-lettered. |
| `status` | `VARCHAR(50)` | No | `'IN_PROGRESS'` | `CHECK (status IN ('IN_PROGRESS', 'SUCCESS', 'PARTIAL_FAILURE', 'FAILED'))` | Batch execution status. |
| `started_at` | `TIMESTAMPTZ` | No | `now()` | None | Batch execution start timestamp. |
| `completed_at` | `TIMESTAMPTZ` | Yes | `NULL` | None | Batch execution completion timestamp. |
| `log_summary` | `JSONB` | Yes | `NULL` | None | Diagnostic JSON metadata (timings, event IDs, errors). |

- **Indexes:**
  - `idx_sync_runs_started`: `btree (started_at DESC)`
  - `idx_sync_runs_status`: `btree (status)`
- **RLS Summary:** Readable by `SUPERADMIN`; written by `service_role`.

---

### 1.7 `audit_logs`
*Central node append-only security and compliance audit trail.*
- **Authoritative Master:** `nexus-central`

| Column Name | Data Type | Nullable | Default | Constraints | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | `PRIMARY KEY` | Audit entry ID. |
| `actor_id` | `UUID` | Yes | `NULL` | None | User UUID who initiated the action. |
| `actor_email` | `VARCHAR(255)` | Yes | `NULL` | None | Email of the acting identity. |
| `branch_id` | `UUID` | Yes | `NULL` | `REFERENCES branches(id) ON DELETE SET NULL` | Target branch if applicable. |
| `action` | `VARCHAR(100)` | No | None | None | Action tag (e.g. `'CREATE_BRANCH'`, `'UPDATE_ROLE'`). |
| `entity_type` | `VARCHAR(100)` | No | None | None | Target entity name (e.g. `'user_profiles'`). |
| `entity_id` | `UUID` | Yes | `NULL` | None | Target entity record UUID. |
| `old_values` | `JSONB` | Yes | `NULL` | None | Snapshot of fields prior to modification. |
| `new_values` | `JSONB` | Yes | `NULL` | None | Snapshot of fields after modification. |
| `ip_address` | `VARCHAR(45)` | Yes | `NULL` | None | IPv4 or IPv6 client address. |
| `user_agent` | `TEXT` | Yes | `NULL` | None | HTTP client user-agent string. |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | None | Event timestamp. |

- **Indexes:**
  - `idx_audit_central_created`: `btree (created_at DESC)`
  - `idx_audit_central_entity`: `btree (entity_type, entity_id)`
  - `idx_audit_central_actor`: `btree (actor_id)`
- **Immutability Policy:** Append-only. `UPDATE` and `DELETE` grants are revoked from all roles.

---

# SECTION 2: NODE 2 — BRANCH A DATABASE (`nexus-branch-a`)

**Project Ref:** `uneycmbqqpkifwhwzbes` | **Host:** `db.uneycmbqqpkifwhwzbes.supabase.co`  
**Engine:** PostgreSQL 17 | **Table Count:** **10 Application Tables**  
**Authority:** Master authority for branch organization, departments, positions, operational employee profiles, shifts, daily scheduling, attendance check-in/out, leave requests, and transactional outbox.

---

### 2.1 `branch_config`
*Local singleton configuration for Branch A.*
- **Authoritative Master:** `nexus-branch-a` (Initialized at provisioning)

| Column Name | Data Type | Nullable | Default | Constraints | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `UUID` | No | `'00000000-0000-0000-0000-000000000001'::uuid` | `PRIMARY KEY`, `CHECK (id = '00000000-0000-0000-0000-000000000001'::uuid)` | Enforced deterministic constant primary key. |
| `branch_code` | `VARCHAR(20)` | No | `'BRANCH-A'` | `UNIQUE` | Matches Central `branches.code`. |
| `branch_name` | `VARCHAR(100)` | No | `'Branch A - Jakarta'` | None | Friendly local display name. |
| `operating_timezone`| `VARCHAR(50)` | No | `'Asia/Jakarta'` | None | Operational timezone for local business logic. |
| `attendance_grace_period_mins`| `INT` | No | `15` | `CHECK (attendance_grace_period_mins >= 0)` | Leniency window in minutes before check-in is marked LATE. |
| `max_overtime_hours_per_day` | `NUMERIC(4,2)`| No | `4.00` | `CHECK (max_overtime_hours_per_day >= 0)` | Daily cap on approved overtime hours. |
| `updated_at` | `TIMESTAMPTZ` | No | `now()` | None | Configuration last updated. |

- **Deterministic Singleton Enforcement:** The check constraint `CHECK (id = '00000000-0000-0000-0000-000000000001'::uuid)` combined with `PRIMARY KEY` physically guarantees that no more than exactly one row can ever exist in this table.
- **RLS Summary:** Readable by all branch users; updates restricted to `BRANCH_MANAGER`.

---

### 2.2 `departments`
*Branch organizational departments.*
- **Authoritative Master:** `nexus-branch-a`

| Column Name | Data Type | Nullable | Default | Constraints | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | `PRIMARY KEY` | Department ID. |
| `code` | `VARCHAR(20)` | No | None | `UNIQUE`, `CHECK (code ~ '^[A-Z0-9\-_]+$')` | Department code (e.g. `'ENG'`, `'OPS'`). |
| `name` | `VARCHAR(100)` | No | None | None | Department name. |
| `description` | `TEXT` | Yes | `NULL` | None | Department mandate description. |
| `is_active` | `BOOLEAN` | No | `TRUE` | None | Operational availability flag. |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | None | Record creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | No | `now()` | None | Record modification timestamp. |

- **Indexes:**
  - `idx_dept_code`: `UNIQUE btree (code)`
  - `idx_dept_is_active`: `btree (is_active)`
- **RLS Summary:** Readable by all branch users; mutations restricted to `BRANCH_HR` and `BRANCH_MANAGER`.

---

### 2.3 `positions`
*Job titles and hierarchy grades within departments.*
- **Authoritative Master:** `nexus-branch-a`

| Column Name | Data Type | Nullable | Default | Constraints | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | `PRIMARY KEY` | Position ID. |
| `department_id` | `UUID` | No | None | `REFERENCES departments(id) ON DELETE RESTRICT` | Associated department foreign key. |
| `code` | `VARCHAR(20)` | No | None | `UNIQUE`, `CHECK (code ~ '^[A-Z0-9\-_]+$')` | Position code (e.g. `'POS-ENG-01'`). |
| `title` | `VARCHAR(100)` | No | None | None | Job title (e.g. `'Senior Software Engineer'`). |
| `grade_level` | `VARCHAR(20)` | Yes | `NULL` | None | Corporate compensation grade (e.g. `'L3'`). |
| `is_active` | `BOOLEAN` | No | `TRUE` | None | Active availability flag. |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | None | Record creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | No | `now()` | None | Record modification timestamp. |

- **Constraints & Indexes:**
  - `uq_positions_id_dept`: `UNIQUE (id, department_id)` *(Required to support composite foreign key on `employees`)*
  - `idx_positions_dept`: `btree (department_id)`
  - `idx_positions_code`: `UNIQUE btree (code)`
- **RLS Summary:** Readable by all branch users; mutations restricted to `BRANCH_HR`.

---

### 2.4 `employees`
*Operational master table for all personnel assigned to Branch A.*
- **Authoritative Master:** `nexus-branch-a`
- **Synchronization:** Domain mutations atomically write to `sync_outbox` to project into Central `employee_directory`.

| Column Name | Data Type | Nullable | Default | Constraints | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | `PRIMARY KEY` | Globally unique employee UUID. |
| `employee_code` | `VARCHAR(50)` | No | None | `UNIQUE` | Unique badge code (generated via sequence: `EMP-A-0001`). |
| `user_auth_id` | `UUID` | Yes | `NULL` | None | Logical pointer to `nexus-central.auth.users.id`. |
| `department_id` | `UUID` | No | None | `REFERENCES departments(id) ON DELETE RESTRICT` | Primary operational department. |
| `position_id` | `UUID` | No | None | `REFERENCES positions(id) ON DELETE RESTRICT` | Primary job position. |
| `full_name` | `VARCHAR(150)` | No | None | None | Full legal employee name. |
| `email` | `VARCHAR(255)` | No | None | `UNIQUE` | Permanent unique corporate email. |
| `phone_number` | `VARCHAR(50)` | Yes | `NULL` | None | Contact telephone. |
| `employment_status`| `VARCHAR(50)` | No | `'PERMANENT'` | `CHECK (employment_status IN ('PERMANENT', 'CONTRACT', 'INTERN', 'PROBATION'))` | Contract classification. |
| `join_date` | `DATE` | No | None | None | Employment start date. |
| `resignation_date` | `DATE` | Yes | `NULL` | None | Termination or resignation date. |
| `is_active` | `BOOLEAN` | No | `TRUE` | None | Operational active status flag. |
| `is_deleted` | `BOOLEAN` | No | `FALSE` | None | Soft-deletion flag preserving historical references. |
| `deleted_at` | `TIMESTAMPTZ` | Yes | `NULL` | None | Timestamp of soft-deletion. |
| `version` | `BIGINT` | No | `1` | None | Optimistic locking and aggregate sync version. |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | None | Record creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | No | `now()` | None | Record modification timestamp. |

- **Composite Integrity Foreign Key:**
  ```sql
  CONSTRAINT fk_employee_position_dept
  FOREIGN KEY (position_id, department_id)
  REFERENCES positions(id, department_id)
  ON DELETE RESTRICT
  ```
  *(Mathematically enforces that an employee cannot be assigned to a position outside their designated department).*
- **Constraints & Business Rules:**
  - `chk_emp_resignation`: `CHECK (resignation_date IS NULL OR resignation_date >= join_date)`
  - Hard `DELETE` operations are revoked from roles and blocked by a `BEFORE DELETE` defensive trigger.
  - `employee_code` and `email` remain permanently unique globally (`UNIQUE (employee_code)` and `UNIQUE (email)` across all rows) to prevent historical identity reuse.
- **Indexes:**
  - `idx_employees_code`: `UNIQUE btree (employee_code)`
  - `idx_employees_email`: `UNIQUE btree (email)`
  - `idx_employees_dept_pos`: `btree (department_id, position_id)`
  - `idx_employees_active`: `btree (is_active) WHERE is_deleted = FALSE`
- **RLS Summary:** Employees read own record (`user_auth_id = auth.uid()`); `BRANCH_HR`/`BRANCH_MANAGER` read all branch records; mutations restricted to `BRANCH_HR`.

---

### 2.5 `shifts`
*Work shift definitions supporting regular and overnight timeframes.*
- **Authoritative Master:** `nexus-branch-a`

| Column Name | Data Type | Nullable | Default | Constraints | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | `PRIMARY KEY` | Shift ID. |
| `code` | `VARCHAR(20)` | No | None | `UNIQUE`, `CHECK (code ~ '^[A-Z0-9\-_]+$')` | Shift code (e.g. `'SHIFT-M'`, `'SHIFT-N'`). |
| `name` | `VARCHAR(100)` | No | None | None | Descriptive title (e.g. `'Morning Shift'`, `'Night Shift'`). |
| `start_time` | `TIME` | No | None | None | Scheduled start of shift (local time). |
| `end_time` | `TIME` | No | None | None | Scheduled end of shift (local time). |
| `is_overnight` | `BOOLEAN` | No | `FALSE` | None | Flag indicating shift crosses midnight into next calendar day. |
| `break_duration_mins`| `INT` | No | `60` | `CHECK (break_duration_mins >= 0)` | Unpaid break duration in minutes. |
| `is_active` | `BOOLEAN` | No | `TRUE` | None | Shift availability flag. |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | None | Record creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | No | `now()` | None | Record modification timestamp. |

- **Overnight Constraint:**
  ```sql
  CONSTRAINT chk_shift_overnight_chronology
  CHECK ((is_overnight = FALSE AND end_time > start_time) OR (is_overnight = TRUE AND end_time <= start_time))
  ```
- **Indexes:**
  - `idx_shifts_code`: `UNIQUE btree (code)`
  - `idx_shifts_is_active`: `btree (is_active)`
- **RLS Summary:** Readable by all branch users; mutations restricted to `BRANCH_HR` and `BRANCH_MANAGER`.

---

### 2.6 `employee_schedules`
*Roster assignments binding an employee to a shift on a specific calendar date.*
- **Authoritative Master:** `nexus-branch-a`

| Column Name | Data Type | Nullable | Default | Constraints | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | `PRIMARY KEY` | Schedule assignment ID. |
| `employee_id` | `UUID` | No | None | `REFERENCES employees(id) ON DELETE RESTRICT` | Target employee foreign key. |
| `shift_id` | `UUID` | No | None | `REFERENCES shifts(id) ON DELETE RESTRICT` | Assigned shift foreign key. |
| `schedule_date` | `DATE` | No | None | None | Calendar date of scheduled shift. |
| `status` | `VARCHAR(50)` | No | `'SCHEDULED'` | `CHECK (status IN ('SCHEDULED', 'SWAPPED', 'CANCELLED', 'LEAVE', 'OFF'))` | Scheduling lifecycle state. |
| `notes` | `TEXT` | Yes | `NULL` | None | Management or dispatch notes. |
| `created_by` | `UUID` | Yes | `NULL` | None | Manager UUID who drafted this schedule. |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | None | Schedule assignment creation time. |
| `updated_at` | `TIMESTAMPTZ` | No | `now()` | None | Schedule assignment modification time. |

- **Integrity Constraints & Composite Reference:**
  - `uq_schedules_id_emp`: `UNIQUE (id, employee_id)` *(Required to support composite foreign key on `attendance`)*
  - `uq_schedules_emp_date_active`: `UNIQUE (employee_id, schedule_date) WHERE (status != 'CANCELLED')`
  - *(Strictly enforces Phase 1 rule: An employee may have at most ONE assigned shift per calendar day).*
- **Indexes:**
  - `idx_schedules_emp_lookup`: `btree (employee_id, schedule_date)`
  - `idx_schedules_date`: `btree (schedule_date)`
- **RLS Summary:** Employees read own schedules; `BRANCH_MANAGER`/`BRANCH_HR` read and manage all branch schedules.

---

### 2.7 `attendance`
*Operational check-in and check-out records bound to scheduled shifts.*
- **Authoritative Master:** `nexus-branch-a`

| Column Name | Data Type | Nullable | Default | Constraints | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | `PRIMARY KEY` | Attendance record ID. |
| `schedule_id` | `UUID` | No | None | `UNIQUE`, `REFERENCES employee_schedules(id) ON DELETE RESTRICT` | **Enforces exactly one attendance record per schedule.** |
| `employee_id` | `UUID` | No | None | `REFERENCES employees(id) ON DELETE RESTRICT` | Foreign key to employee. |
| `attendance_date`| `DATE` | No | None | None | Derived schedule date. |
| `check_in_time` | `TIMESTAMPTZ` | No | None | None | Check-in timestamp (UTC). |
| `check_out_time`| `TIMESTAMPTZ` | Yes | `NULL` | None | Check-out timestamp (UTC). |
| `status` | `VARCHAR(50)` | No | `'ON_TIME'` | `CHECK (status IN ('ON_TIME', 'LATE', 'EARLY_DEPARTURE', 'OVERTIME', 'INCOMPLETE', 'ABSENT'))` | Attendance classification. |
| `check_in_method`| `VARCHAR(50)`| No | `'MANUAL_WEB'`| None | Verification channel (e.g. `'MANUAL_WEB'`, `'QR_CODE'`). |
| `check_out_method`| `VARCHAR(50)`| Yes| `NULL` | None | Channel used for check-out. |
| `check_in_notes` | `TEXT` | Yes | `NULL` | None | Employee check-in justification. |
| `check_out_notes`| `TEXT` | Yes | `NULL` | None | Employee check-out justification. |
| `check_in_ip` | `VARCHAR(45)` | Yes | `NULL` | None | Client IP address at check-in. |
| `check_out_ip` | `VARCHAR(45)` | Yes | `NULL` | None | Client IP address at check-out. |
| `is_verified` | `BOOLEAN` | No | `FALSE` | None | Managerial verification flag. |
| `verified_by` | `UUID` | Yes | `NULL` | None | Manager UUID who approved. |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | None | Record creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | No | `now()` | None | Record modification timestamp. |

- **Composite Integrity Foreign Key:**
  ```sql
  CONSTRAINT fk_attendance_schedule_employee
  FOREIGN KEY (schedule_id, employee_id)
  REFERENCES employee_schedules(id, employee_id)
  ON DELETE RESTRICT
  ```
  *(Guarantees that an attendance record cannot be associated with a schedule belonging to another employee).*
- **Chronology & Duration Invariants:**
  ```sql
  CONSTRAINT chk_attendance_checkout_chronology
  CHECK (check_out_time IS NULL OR (check_out_time > check_in_time AND check_out_time <= check_in_time + INTERVAL '24 hours'))
  ```
  *(Allows overnight shifts to check out the following morning, while preventing invalid retroactive checkouts or duration > 24 hours).*
  - Future check-in time prevention is enforced via server-side business logic and a `BEFORE INSERT` trigger, preserving constraint determinism.
- **Indexes:**
  - `idx_attendance_schedule`: `UNIQUE btree (schedule_id)`
  - `idx_attendance_emp_date`: `btree (employee_id, attendance_date DESC)`
  - `idx_attendance_date`: `btree (attendance_date)`
- **RLS Summary:** Employees read own attendance and insert check-in / update check-out for own records; `BRANCH_MANAGER` verifies (`is_verified`); `service_role` has full administrative access.

---

### 2.8 `leave_requests`
*Employee leave and permission applications with managerial approval workflow.*
- **Authoritative Master:** `nexus-branch-a`
- **Approval Authority:** `BRANCH_MANAGER` on Branch A. Central HR inspects summaries but cannot overwrite local approval decisions.

| Column Name | Data Type | Nullable | Default | Constraints | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | `PRIMARY KEY` | Leave request ID. |
| `employee_id` | `UUID` | No | None | `REFERENCES employees(id) ON DELETE RESTRICT` | Submitting employee. |
| `leave_type` | `VARCHAR(50)` | No | `'ANNUAL'` | `CHECK (leave_type IN ('ANNUAL', 'SICK', 'MATERNITY', 'UNPAID', 'SPECIAL_PERMISSION'))` | Category of leave. |
| `start_date` | `DATE` | No | None | None | First day of leave period. |
| `end_date` | `DATE` | No | None | None | Final day of leave period. |
| `total_days` | `NUMERIC(4,1)`| No | None | `CHECK (total_days > 0)` | Calculated business days requested. |
| `reason` | `TEXT` | No | None | None | Employee justification text. |
| `status` | `VARCHAR(50)` | No | `'PENDING'` | `CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'))` | Approval workflow state. |
| `submitted_at` | `TIMESTAMPTZ` | No | `now()` | None | Application submission timestamp. |
| `approved_by` | `UUID` | Yes | `NULL` | None | Manager UUID who acted on request. |
| `approved_at` | `TIMESTAMPTZ` | Yes | `NULL` | None | Timestamp of approval decision. |
| `rejection_reason`| `TEXT` | Yes | `NULL` | None | Mandatory justification if `status = 'REJECTED'`. |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | None | Record creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | No | `now()` | None | Record modification timestamp. |

- **Constraints & Business Invariants:**
  - `chk_leave_dates`: `CHECK (end_date >= start_date)`
  - `chk_leave_rejection`: `CHECK (status != 'REJECTED' OR rejection_reason IS NOT NULL)`
  - Overlap prevention: Enforced via a `BEFORE INSERT OR UPDATE` trigger preventing an employee from having multiple overlapping `APPROVED` leave requests across the same date range.
- **Indexes:**
  - `idx_leave_emp_status`: `btree (employee_id, status)`
  - `idx_leave_dates`: `btree (start_date, end_date)`
- **RLS Summary:** Employees create/read own requests; `BRANCH_MANAGER` approves/rejects; employees cannot approve own requests.

---

### 2.9 `sync_outbox`
*Transactional outbox storing domain events for asynchronous relay to Central.*
- **Authoritative Master:** Branch A System Queue

| Column Name | Data Type | Nullable | Default | Constraints | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | `PRIMARY KEY` | Internal outbox queue ID. |
| `event_id` | `UUID` | No | `gen_random_uuid()` | `UNIQUE` | Globally unique event UUID passed to Central inbox. |
| `aggregate_type` | `VARCHAR(100)` | No | None | None | Entity domain category (`'EMPLOYEE'`, `'ATTENDANCE_SUMMARY'`). |
| `aggregate_id` | `UUID` | No | None | None | Primary key of the affected domain record. |
| `aggregate_version`| `BIGINT` | No | `1` | None | Monotonically increasing aggregate version number. |
| `event_type` | `VARCHAR(100)` | No | None | None | Event name (`'EMPLOYEE_UPSERTED'`, `'ATTENDANCE_SUMMARY_RECORDED'`). |
| `payload` | `JSONB` | No | None | None | Full immutable JSON snapshot of entity state. |
| `status` | `VARCHAR(50)` | No | `'PENDING'` | `CHECK (status IN ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED'))` | Relay delivery status. |
| `locked_by` | `VARCHAR(100)` | Yes | `NULL` | None | Worker identifier holding claim. |
| `locked_at` | `TIMESTAMPTZ` | Yes | `NULL` | None | Timestamp claim lease was established. |
| `retry_count` | `INT` | No | `0` | None | Number of dispatch attempts made. |
| `next_retry_at` | `TIMESTAMPTZ` | Yes | `NULL` | None | Timestamp for next eligible retry attempt. |
| `last_error` | `TEXT` | Yes | `NULL` | None | Diagnostic error text from last failed attempt. |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | None | Outbox transaction commit time. |
| `published_at` | `TIMESTAMPTZ` | Yes | `NULL` | None | Timestamp Central durably acknowledged inbox insertion. |

- **Indexes:**
  - `idx_sync_outbox_queue`: `btree (status, next_retry_at, created_at) WHERE status IN ('PENDING', 'PROCESSING', 'FAILED')`
  - `idx_sync_outbox_event_id`: `UNIQUE btree (event_id)`
- **RLS Summary:** Restricted exclusively to internal `service_role`.

---

### 2.10 `audit_logs`
*Branch A local append-only audit log tracking all operational modifications.*
- **Authoritative Master:** `nexus-branch-a`

| Column Name | Data Type | Nullable | Default | Constraints | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | `PRIMARY KEY` | Audit record ID. |
| `actor_id` | `UUID` | Yes | `NULL` | None | Identity who executed the transaction. |
| `actor_email` | `VARCHAR(255)` | Yes | `NULL` | None | Identity email. |
| `branch_id` | `UUID` | Yes | `NULL` | None | Local branch identifier reference. |
| `action` | `VARCHAR(100)` | No | None | None | Transaction operation tag (e.g. `'CHECK_IN'`, `'APPROVE_LEAVE'`). |
| `entity_type` | `VARCHAR(100)` | No | None | None | Target entity name (e.g. `'attendance'`). |
| `entity_id` | `UUID` | Yes | `NULL` | None | ID of target entity. |
| `old_values` | `JSONB` | Yes | `NULL` | None | Prior state snapshot. |
| `new_values` | `JSONB` | Yes | `NULL` | None | Resulting state snapshot. |
| `ip_address` | `VARCHAR(45)` | Yes | `NULL` | None | Client IP address. |
| `user_agent` | `TEXT` | Yes | `NULL` | None | Client browser/agent string. |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | None | Mutation timestamp. |

- **Indexes:**
  - `idx_audit_branch_created`: `btree (created_at DESC)`
  - `idx_audit_branch_entity`: `btree (entity_type, entity_id)`
  - `idx_audit_branch_actor`: `btree (actor_id)`
- **Immutability Policy:** Append-only. `UPDATE` and `DELETE` grants are revoked from all roles.
