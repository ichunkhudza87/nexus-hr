# NEXUS HR — Distributed Database Architecture Specification

**System:** NEXUS HR Multi-Branch Attendance & Scheduling System  
**Academic Context:** Database 3 University Project / Advanced Distributed Databases  
**Revision:** 2.0.0 (Comprehensive Architecture Revision)  
**Date:** November 2026  
**Workspace:** `D:\Antigravity_Projects\nexus-hr`  
**Status:** Implementation-Ready Architecture Specification  

---

## 1. Architectural Vision & Topology

NEXUS HR is a distributed multi-branch enterprise human resources and attendance management system. The platform employs a **two-node horizontally fragmented PostgreSQL architecture** designed to guarantee local operational autonomy, partition tolerance, and strict data integrity.

```
                      +---------------------------------------+
                      |       NEXUS HR CLIENT / BACKEND       |
                      +-------------------+-------------------+
                                          |
                     +--------------------+--------------------+
                     |                                         |
                     v                                         v
       +----------------------------+            +----------------------------+
       |   NODE 1: CENTRAL NODE     |            |   NODE 2: BRANCH A NODE    |
       |     `nexus-central`        |            |     `nexus-branch-a`       |
       | Supabase Ref:              |            | Supabase Ref:              |
       | wcmevigbqsmzsdqidjel       |            | uneycmbqqpkifwhwzbes       |
       | Region: ap-southeast-1     |            | Region: ap-southeast-1     |
       | Database: PostgreSQL 17    |            | Database: PostgreSQL 17    |
       | 7 Application Tables       |            | 10 Application Tables      |
       +--------------+-------------+            +-------------+--------------+
                      ^                                        |
                      |        SCHEDULED SERVER SYNC WORKER    |
                      |   (Transactional Outbox -> Inbox)      |
                      +----------------------------------------+
```

### 1.1 Physical Separation & Project References
The two nodes are independent PostgreSQL 17 database instances hosted in the Supabase `ap-southeast-1` (Singapore) region:

| Parameter | Node 1: Central Database | Node 2: Branch A Operational Database |
| :--- | :--- | :--- |
| **Project Name** | `nexus-central` | `nexus-branch-a` |
| **Supabase Ref** | `wcmevigbqsmzsdqidjel` | `uneycmbqqpkifwhwzbes` |
| **Database Host** | `db.wcmevigbqsmzsdqidjel.supabase.co` | `db.uneycmbqqpkifwhwzbes.supabase.co` |
| **Direct Port** | 5432 (Session) / 6543 (Transaction Pool) | 5432 (Session) / 6543 (Transaction Pool) |
| **Engine** | PostgreSQL 17.11.0.018 | 17.11.0.018 |
| **Application Tables** | **7 tables** | **10 tables** |
| **Total System Tables** | \multicolumn{2}{c}{**17 Application Tables** (excluding Supabase internal schemas)} |

### 1.2 Core Architectural Principles
1. **Physical Isolation:** Independent storage, memory, connection pools, and query planners. A maintenance event, failure, or heavy query on Central never degrades local check-ins on Branch A.
2. **Local Operational Autonomy:** Branch A can execute daily attendance, roster checks, and leave requests completely offline from Central.
3. **No Cross-Node Foreign Keys:** Physical PostgreSQL `REFERENCES` cannot cross instance boundaries. All inter-node relationships are managed as **logical references**.
4. **Asynchronous Transactional Replication:** Cross-node data synchronization uses an application-level **Transactional Outbox / Idempotent Inbox** architecture. Supabase Realtime is NOT used for inter-database replication.
5. **Eventual Consistency:** Central projections and consolidated summaries reflect Branch operations within an acceptable synchronization window (target $\le 5$ seconds during active sync execution).

---

## 2. Table Inventory & Source-of-Truth Ownership

The system consists of exactly **17 application tables** across both nodes. Each table has a single, unambiguously documented authoritative master node.

### 2.1 Table Inventory Matrix

| Node | Table Name | Master Authority | Role & Purpose |
| :--- | :--- | :---: | :--- |
| **Central** | `branches` | `nexus-central` | Global master registry of corporate branches. |
| **Central** | `user_profiles` | `nexus-central` | Global identity profiles bound 1:1 to Central Supabase Auth (`auth.users`). |
| **Central** | `employee_directory` | `nexus-branch-a` | Read-only synchronized projection of active branch employees for corporate search. |
| **Central** | `attendance_daily_summaries` | `nexus-branch-a` | Aggregated daily branch attendance summaries for corporate reporting. |
| **Central** | `sync_inbox` | Central System | Inbound event staging queue ensuring idempotent event processing. |
| **Central** | `sync_runs` | Central System | Execution telemetry and auditing for synchronization batches. |
| **Central** | `audit_logs` | `nexus-central` | Central immutable audit log for corporate identity and configuration actions. |
| **Branch A** | `branch_config` | `nexus-branch-a` | Local singleton branch configuration (enforced single-row). |
| **Branch A** | `departments` | `nexus-branch-a` | Master organizational units for Branch A. |
| **Branch A** | `positions` | `nexus-branch-a` | Master job positions tied to departments. |
| **Branch A** | `employees` | `nexus-branch-a` | Authoritative operational employee master with soft-delete support. |
| **Branch A** | `shifts` | `nexus-branch-a` | Work shift definitions supporting regular and overnight timeframes. |
| **Branch A** | `employee_schedules` | `nexus-branch-a` | Roster assignments (strictly one shift per employee per calendar day). |
| **Branch A** | `attendance` | `nexus-branch-a` | Operational check-in/out records bound 1:1 to schedules. |
| **Branch A** | `leave_requests` | `nexus-branch-a` | Leave applications and Branch Manager approvals. |
| **Branch A** | `sync_outbox` | `nexus-branch-a` | Local transactional outbox queue capturing domain events atomically. |
| **Branch A** | `audit_logs` | `nexus-branch-a` | Local immutable audit log for branch operational mutations. |

---

## 3. Synchronization Architecture

### 3.1 Unidirectional Sync Policy (Phase 1)
To ensure system stability, prevent distributed write cycles, and eliminate split-brain anomalies, Phase 1 strictly implements **Unidirectional Synchronization (Branch A $\rightarrow$ Central)**:

```
[ Branch A Operational DB ]
           |
      Local Atomic Commit (Domain Table + sync_outbox)
           |
           v
   [ sync_outbox ]
           |
   (Scheduled Worker reads with lease & FOR UPDATE SKIP LOCKED)
           |
           v
[ Central sync_inbox ] ---> Idempotent Ingestion (ON CONFLICT (event_id) DO NOTHING)
           |
      Transactional Projection Materialization
           |
           +---> employee_directory (Versioned UPSERT)
           +---> attendance_daily_summaries (Aggregated UPSERT)
```

- **Branch A $\rightarrow$ Central Data Flows:**
  - `EMPLOYEE_UPSERTED` / `EMPLOYEE_DEACTIVATED`: Updates `employee_directory`.
  - `ATTENDANCE_SUMMARY_RECORDED`: Updates `attendance_daily_summaries`.
  - `LEAVE_SUMMARY_UPDATED`: Updates centralized leave metrics.
  - Telemetry: Populates `sync_runs`.
- **Central $\rightarrow$ Branch A Limitation (Phase 1):**
  - **No dynamic reverse synchronization** is implemented in Phase 1.
  - The Central branch registry is managed centrally. Branch A receives its branch identity during initial deployment/provisioning via its local `branch_config` singleton table.
  - Changes to corporate branch policies are deployed via administrative configuration procedures rather than an always-on reverse replication pipeline.

### 3.2 Outbox Claiming, Locking, and Lease Recovery
To allow safe concurrent worker execution without double-dispatching events or deadlocks, `sync_outbox` implements an **optimistic lease claiming protocol**:

1. **Claiming Batch:**
   The sync worker selects and locks pending events in a dedicated transaction using PostgreSQL `FOR UPDATE SKIP LOCKED`:
   ```sql
   UPDATE sync_outbox
   SET status = 'PROCESSING',
       locked_by = :worker_id,
       locked_at = now()
   WHERE id IN (
     SELECT id FROM sync_outbox
     WHERE (status = 'PENDING' AND (next_retry_at IS NULL OR next_retry_at <= now()))
        OR (status = 'PROCESSING' AND locked_at < now() - INTERVAL '5 minutes') -- Expired lease recovery
     ORDER BY created_at ASC
     LIMIT 50
     FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
   ```
2. **Lease Expiration & Crash Recovery:**
   - Row locks release immediately upon claim transaction commit.
   - If a worker crashes mid-transmission, other workers reclaim events whose lease has expired (`locked_at < now() - INTERVAL '5 minutes'`), returning them safely from `PROCESSING` to `PENDING`.
3. **Safe Publishing Confirmation:**
   - Once Central acknowledges durable insertion into `sync_inbox`, the worker marks events:
   ```sql
   UPDATE sync_outbox
   SET status = 'PUBLISHED',
       published_at = now(),
       locked_by = NULL,
       locked_at = NULL
   WHERE id = :event_id AND locked_by = :worker_id;
   ```
   - Crucially, filtering by `locked_by = :worker_id` prevents a worker whose lease expired from overwriting another active worker's claim.

### 3.3 Inbox Processing, Idempotency, and Monotonic Versioning
Central's `sync_inbox` acts as the ingestion barrier:
1. **Deduplication:** The constraint `event_id UUID UNIQUE NOT NULL` ensures duplicate HTTP transmissions are discarded cleanly:
   ```sql
   INSERT INTO sync_inbox (event_id, source_node, event_type, aggregate_type, aggregate_id, aggregate_version, schema_version, payload, status)
   VALUES (...)
   ON CONFLICT (event_id) DO NOTHING;
   ```
2. **Projection Materialization:**
   - An inbox consumer processes events in a transaction.
   - For `employee_directory`, stale events arriving out of order are ignored via monotonic version checking:
     $$\text{UPDATE WHERE incoming.aggregate\_version} > \text{employee\_directory.version}$$
   - If projection materialization succeeds, `sync_inbox.status` transitions to `'PROCESSED'` and `processed_at = now()`.
   - If materialization encounters an error, the transaction rolls back, `retry_count` is incremented, and status is set to `'FAILED'` with exponential backoff:
     $$\text{next\_retry\_at} = \text{now}() + (2^{\text{retry\_count}} \times 1\text{ second}) + \text{jitter}$$
   - After 5 consecutive failures, the event transitions to `'DEAD_LETTER'` to prevent queue blockage.
3. **Delivery Guarantee:** **At-least-once delivery with idempotent processing** (Effectively-Once semantics).

---

## 4. Central Attendance Reporting Architecture

### 4.1 `attendance_daily_summaries`
Central does not replicate raw operational attendance logs (check-in/out timestamps, IP addresses, photos). Instead, Central maintains daily aggregated metrics per branch in `attendance_daily_summaries`:

- **Unique Grain:** `UNIQUE(branch_id, summary_date)`
- **Aggregated Metrics:** `total_employees`, `present_count`, `late_count`, `absent_count`, `leave_count`.
- **Integrity Invariants:**
  - Non-negative counts: `CHECK (total_employees >= 0 AND present_count >= 0 AND late_count >= 0 AND absent_count >= 0 AND leave_count >= 0)`
  - Capacity consistency: `CHECK (present_count + late_count + absent_count + leave_count <= total_employees)`
- **Aggregation Calculation:**
  - Branch A calculates rollups at shift cutoffs or daily close.
  - Present: Check-in recorded with `status = 'ON_TIME'`.
  - Late: Check-in recorded with `status = 'LATE'`.
  - Absent: Schedule exists with `status = 'SCHEDULED'` but no check-in by day close.
  - Leave: Schedule or approved leave request covering that calendar date.
- **Historical Recalculation & Idempotency:**
  - If a manager retroactively verifies or corrects an attendance record (e.g. excused absence or retroactive check-in adjustment), Branch A recalculates that specific date's summary, increments `source_version`, and publishes an `ATTENDANCE_SUMMARY_RECORDED` event.
  - Central updates its summary row only if `incoming.source_version > existing.source_version`.

---

## 5. Relational Integrity & Business Invariants

### 5.1 Department-Position Consistency on Employees
To guarantee that an employee cannot be assigned to a position that belongs to another department, Branch A enforces a **composite foreign key**:
- Table `positions`: Contains `UNIQUE (id, department_id)`.
- Table `employees`: Enforces:
  ```sql
  FOREIGN KEY (position_id, department_id)
  REFERENCES positions(id, department_id)
  ON DELETE RESTRICT;
  ```
This makes cross-department position assignment physically impossible at the database engine level.

### 5.2 Attendance-Schedule-Employee Integrity
To ensure an attendance check-in cannot be credited to an employee other than the one rostered for the schedule:
- Table `employee_schedules`: Contains `UNIQUE (id, employee_id)`.
- Table `attendance`: Enforces:
  ```sql
  FOREIGN KEY (schedule_id, employee_id)
  REFERENCES employee_schedules(id, employee_id)
  ON DELETE RESTRICT;
  ```
- Combined with `UNIQUE (schedule_id)` on `attendance`, this guarantees **strictly one attendance record per schedule** and exact employee identity alignment.

### 5.3 One Shift Per Employee Per Day (Phase 1 Decision)
To ensure scheduling simplicity and deterministic attendance matching, Phase 1 strictly enforces:
```sql
UNIQUE (employee_id, schedule_date) WHERE (status != 'CANCELLED')
```
An employee can have at most one active rostered shift per calendar date.

### 5.4 Robust Branch Config Singleton
Rather than an ineffective `CHECK (id IS NOT NULL)` condition, `branch_config` enforces a deterministic single-row guarantee using a constant UUID primary key:
```sql
id UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid
  CHECK (id = '00000000-0000-0000-0000-000000000001'::uuid)
```
Any attempt to insert a second row produces a primary key collision (`duplicate key value violates unique constraint`).

### 5.5 Concurrency-Safe Employee Code Generation
Employee badge codes follow the pattern `EMP-A-0001` for Branch A (and `EMP-B-0001` for future branches).
- Enforced via a dedicated PostgreSQL sequence:
  ```sql
  CREATE SEQUENCE seq_branch_a_employee_code START WITH 1 INCREMENT BY 1;
  ```
- Generated via a `BEFORE INSERT` trigger function:
  ```sql
  NEW.employee_code := 'EMP-A-' || lpad(nextval('seq_branch_a_employee_code')::text, 4, '0');
  ```
- Concurrency-safe, race-condition free, and independent of table row counts.

### 5.6 Soft Delete & Identity Preservation
- Operational employee records support soft-deletion via `is_deleted BOOLEAN NOT NULL DEFAULT FALSE` and `deleted_at TIMESTAMPTZ`.
- Hard `DELETE` operations are revoked via database privileges and blocked by a `BEFORE DELETE` defensive trigger.
- **Identity Preservation:** `employee_code` and `email` remain permanently unique globally (`UNIQUE (employee_code)` and `UNIQUE (email)` across all rows, including deleted). This guarantees badges and corporate email identities can never be recycled or cause audit trail confusion.

### 5.7 Shift Modeling & Attendance Chronology
- Shift overnight handling:
  ```sql
  CHECK ((is_overnight = FALSE AND end_time > start_time) OR (is_overnight = TRUE AND end_time <= start_time))
  ```
- Attendance checkout chronology:
  ```sql
  CHECK (check_out_time IS NULL OR (check_out_time > check_in_time AND check_out_time <= check_in_time + INTERVAL '24 hours'))
  ```
- Check-in future-time validation is enforced in server-side API logic and a `BEFORE INSERT` trigger, avoiding dynamic `now()` functions in static table constraints.

---

## 6. Worker Execution Architecture

The synchronization worker is a dedicated **Node.js/TypeScript server process**:
- **Environment:** Node.js server runtime, Docker container, or scheduled cloud worker (e.g. AWS Lambda / Cloud Run / Supabase Edge Function scheduled via cron).
- **Execution Mode:**
  - **Development:** On-demand execution (`npm run sync:once`) or short-interval cron for testing.
  - **Production:** Scheduled execution at an economical interval (e.g. every 1 to 5 minutes) rather than an unthrottled continuous 3-second polling loop.
- **Interruption Resilience:** All state transitions use explicit lease acquisition and transaction boundaries. If the process is terminated mid-batch, no events are lost, and the next run safely reclaims expired leases.
- **Browser Exclusion:** The worker connects exclusively via server-side credentials. It never runs inside client browser bundles or Netlify Edge frontend contexts.
