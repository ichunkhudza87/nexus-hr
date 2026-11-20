# Phase 3.12E — Data Safety and Migration Risk Assessment

**Date:** 2026-11-12

---

## 1. Risk Assessment Matrix

| Target | Table / Column | Current Condition | Affected Rows | Data Modified/Deleted by Migration? | Stops Safely? | Resolution |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `nexus-branch-a` | `public.branch_config` (`is_active` missing) | Column `is_active` does not exist (`E-01`) | `1` (`BRANCH-A` singleton) | **No** (aborts cleanly in `BEGIN` block at `L59`) | **Yes** (`42703`) | Fix `v2.7.2` to remove `is_active` reference on `branch_config` |
| `nexus-branch-a` | `nexus_internal.tx_actor_context` | Table does not exist yet | `0` | No (`CREATE TABLE` fresh path) | Yes | Safe |
| `nexus-branch-a` | `public.employees`, `leave_requests`, `audit_logs`, `sync_outbox` | All empty (`0` rows) | `0` | No | Yes | Safe |
| `nexus-branch-a` | `public.seq_branch_a_employee_code` | `last_value = null`, `max_value = 9223372036854776000` | N/A | No (`ALTER SEQUENCE MAXVALUE 999999999999 NO CYCLE`) | Yes | Safe |
| `nexus-central` | `public.branches` | Empty (`0` rows), zero conflicts (`E-02`) | `0` | Inserts 1 `BRANCH-A` row on seed run | Yes (`ON CONFLICT DO NOTHING`) | Run `002_central_seed...` during staged execution |
| `nexus-central` | `employee_directory`, `attendance_daily_summaries`, `user_profiles`, `audit_logs` | All empty (`0` rows) | `0` | No | Yes | Safe |

---

## 2. Fact vs Static / Unverified Separation

- **Verified Database Facts:** PG 17.11 engine, all table/column/constraint/trigger/policy/grant counts, `branch_config` missing `is_active`, and `0`-row data counts on both projects.
- **Local SQL Static-Analysis Findings:** `001_branch_a_security_remediation_v2_7_1.sql:L59, L433, L437` references `branch_config.is_active`.
- **Unverified PostgreSQL Runtime Behavior:** Local PG17 runtime execution of `v2.7.1` remains `NOT VERIFIED` locally; remote PG `17.11` will be the target runtime during authorized Phase 3.12F+ staged execution.
