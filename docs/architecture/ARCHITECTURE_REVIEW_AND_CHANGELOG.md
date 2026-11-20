# NEXUS HR — Architecture Review & Changelog (Revision 2.0.0)

**Project:** NEXUS HR Multi-Branch Distributed Database System  
**Date:** November 2026  
**Document:** `ARCHITECTURE_REVIEW_AND_CHANGELOG.md`  
**Workspace:** `D:\Antigravity_Projects\nexus-hr`  

---

## 1. Executive Summary of Corrections

Following a comprehensive senior architectural and security review, the NEXUS HR database architecture and technical documentation have been revised from **Revision 1.0.0** to **Revision 2.0.0**.

The revision addresses 14 key architectural, relational integrity, synchronization, and security findings, ensuring the system is technically rigorous, mathematically sound at the database engine level, and implementation-ready for university Database 3 evaluation and production deployment.

---

## 2. Detailed Change Matrix

| # | Domain | Previous Design Issue (v1.0.0) | Applied Correction (v2.0.0) | Technical Reason | Impact on Database Structure | Impact on Application |
| :-: | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Central Reporting** | Central had no attendance reporting table, requiring cross-database fan-out queries. Table count was 16. | Added `attendance_daily_summaries` to `nexus-central`. Table count updated to **17 application tables** (7 Central, 10 Branch A). | Enables fast corporate dashboard queries without cross-node network latency or direct branch queries. | New Central table with `UNIQUE(branch_id, summary_date)` and capacity check constraints. | Sync worker populates daily rollups from Branch A to Central. |
| **2** | **Sync Direction** | Implied continuous bidirectional synchronization without detailing conflicts. | Defined strictly **Unidirectional Sync (Branch A $\rightarrow$ Central)** for Phase 1. | Eliminates distributed write cycles, race conditions, and split-brain resolution complexity in initial phase. | Formalized in ADR 006 and data dictionaries. | Central branch configuration is provisioned statically; Branch A operational data replicates to Central. |
| **3** | **Worker Architecture** | Described as an unthrottled continuous 3–5 second polling loop. | Re-architected as a **Scheduled Server Worker** (Node.js/TypeScript) with manual execution support. | Prevents connection pool exhaustion, excessive egress, and database CPU drain on Supabase Free tier. | Formalized in Section 6 of Database Architecture. | Supports `npm run sync:once` in dev and scheduled cron (1–5 min) in production. |
| **4** | **Outbox Claiming** | Row locks (`FOR UPDATE`) did not survive claim transaction commit, risking concurrent worker collision. | Added optimistic lease claiming: `locked_by`, `locked_at`, `next_retry_at`, and lease expiration recovery. | Guarantees safe concurrent worker execution without deadlocks or double-dispatching. | Added lease columns and partial index on `sync_outbox`. | Worker claims batch, holds lease, and publishes only with matching `locked_by` token. |
| **5** | **Inbox Idempotency** | Did not explicitly detail monotonic versioning or stale event rejection. | Added `aggregate_version`, `source_version`, and strict monotonic checks: `WHERE incoming.version > current.version`. | Prevents out-of-order network deliveries from overwriting newer entity states. | Added `aggregate_version` and `source_version` across inbox, outbox, directory, and summaries. | Projections safely discard stale events arriving late. |
| **6** | **Department-Position Integrity** | An employee could be assigned a position belonging to a different department. | Added composite foreign key on `employees (position_id, department_id)` referencing `positions (id, department_id)`. | Enforces strict organizational hierarchy at the database engine level rather than relying on frontend code. | Added `UNIQUE (id, department_id)` on `positions` and composite FK on `employees`. | Prevents cross-department position assignment anomalies. |
| **7** | **Attendance-Schedule Integrity** | Attendance record could theoretically be credited to an employee different from the scheduled employee. | Added composite foreign key on `attendance (schedule_id, employee_id)` referencing `employee_schedules (id, employee_id)`. | Mathematically prevents check-in records from being credited to an unassigned employee. | Added `UNIQUE (id, employee_id)` on `employee_schedules` and composite FK on `attendance`. | Impossible to check in against another employee's rostered schedule. |
| **8** | **Scheduling Rule** | Roster rules allowed ambiguous multiple shifts per day. | Strictly enforced **One Shift Per Employee Per Day** via `UNIQUE (employee_id, schedule_date) WHERE (status != 'CANCELLED')`. | Simplifies shift boundaries, overnight calculations, and attendance matching for Phase 1. | Enforced partial unique constraint on `employee_schedules`. | Eliminates double-booking and schedule conflict ambiguity. |
| **9** | **Branch Config Singleton** | Used `CHECK (id IS NOT NULL)`, which fails to prevent multiple configuration rows. | Enforced deterministic constant UUID: `id UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid CHECK (id = '00000000-0000-0000-0000-000000000001'::uuid)`. | Physically prevents insertion of any second row via primary key collision at the PostgreSQL engine level. | Modified `branch_config` primary key and check constraint. | Single-row configuration guaranteed under all circumstances. |
| **10** | **Employee Code Generation** | Lacked a concurrency-safe generation mechanism; risks collisions if using `COUNT(*) + 1`. | Implemented sequential generator: `seq_branch_a_employee_code` producing `EMP-A-0001`. | Concurrency-safe, race-condition free, and independent of soft deletions. | Added sequence and `BEFORE INSERT` trigger function specification. | Automatic sequential badge generation. |
| **11** | **Attendance Chronology** | Attempted to use dynamic `now()` in `CHECK` constraint, which PostgreSQL disallows. | Enforced static duration cap `check_out_time <= check_in_time + INTERVAL '24 hours'`; moved future check-in validation to trigger/API. | Complies with PostgreSQL check constraint immutability while supporting overnight shifts. | Fixed `attendance` check constraints. | Safe support for night shifts crossing midnight. |
| **12** | **Soft Delete Identity** | Unclear whether deleted employee badges or emails could be recycled. | Enforced permanent global uniqueness on `employee_code` and `email` across all rows. | Preserves historical integrity, audit trails, and legal compliance. Badges and emails cannot be recycled. | Retained global unique constraints on `employees`. | Deleted employee identifiers remain reserved indefinitely. |
| **13** | **Cross-Node JWT Trust** | Assumed Branch A automatically trusts Central JWTs or shares signing keys. | Architected **Backend Authentication Gateway** that cryptographically verifies Central JWTs via JWKS before proxying to Branch A. | Independent Supabase projects have different internal signing keys and secrets. | Detailed in `SECURITY_AND_ACCESS.md` and ADR 013. | Client talks to Central for Auth, routes Branch operations through verified backend gateway. |
| **14** | **Security & Privileges** | Missing granular RLS for all 17 tables; audit logs claimed cryptographic non-repudiation. | Authored complete RLS matrix for all 17 tables; defined audit logs as engine-level append-only (`REVOKE UPDATE, DELETE`). | Enforces Principle of Least Privilege; eliminates inaccurate cryptographic claims. | Complete policy matrix across Central (7) and Branch A (10). | Every database operation is bound by explicit role-based access rules. |

---

## 3. Database Table Inventory Reconciliation

### Central Database (`nexus-central`) — Exactly 7 Application Tables
1. `branches`
2. `user_profiles`
3. `employee_directory`
4. `attendance_daily_summaries` *(Added in v2.0.0)*
5. `sync_inbox`
6. `sync_runs`
7. `audit_logs`

### Branch A Database (`nexus-branch-a`) — Exactly 10 Application Tables
1. `branch_config`
2. `departments`
3. `positions`
4. `employees`
5. `shifts`
6. `employee_schedules`
7. `attendance`
8. `leave_requests`
9. `sync_outbox`
10. `audit_logs`

**Total Application Tables:** **17 tables** (excluding internal Supabase schemas such as `auth.users`).

---

## 4. Documentation Artifacts Alignment

All 7 core architectural documents under `docs/architecture/` have been updated and verified:
1. `DATABASE_ARCHITECTURE.md`: Topology, outbox/inbox leases, reporting, and worker design.
2. `DATA_DICTIONARY.md`: Complete specifications for all 17 tables, types, constraints, and indexes.
3. `ERD_CENTRAL.mmd`: Validated Mermaid ERD reflecting all 7 Central tables and relationships.
4. `ERD_BRANCH_A.mmd`: Validated Mermaid ERD reflecting all 10 Branch A tables and composite FKs.
5. `DISTRIBUTED_SYNC_FLOW.mmd`: Validated Mermaid sequence diagram for outbox leasing and idempotent inbox ingestion.
6. `SECURITY_AND_ACCESS.md`: Cryptographic JWT validation gateway, 17-table RLS matrix, and secret management.
7. `DATABASE_DECISIONS.md`: 13 comprehensive Architecture Decision Records (ADR 001 to ADR 013).
8. `ARCHITECTURE_REVIEW_AND_CHANGELOG.md`: This document.
