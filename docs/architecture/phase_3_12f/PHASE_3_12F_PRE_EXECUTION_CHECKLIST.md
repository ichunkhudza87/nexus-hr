# Phase 3.12F — Stage 0 Pre-Execution Checklist

**Date:** 2026-11-12

---

| # | Check | Method | Owner | Expected Pre-Execution State |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Verify Central ref `wcmevigbqsmzsdqidjel` & Branch A ref `uneycmbqqpkifwhwzbes` | Read-only MCP `get_project` | Automated / Operator | `ACTIVE_HEALTHY`, exact refs |
| 2 | Confirm PostgreSQL version `17.11` on both projects | Read-only `SELECT version();` | Automated / Operator | `PostgreSQL 17.11` |
| 3 | Confirm database availability & zero active blocking locks | Read-only `pg_stat_activity` | Automated / Operator | Healthy, no long-running DDL locks |
| 4 | Confirm schema inventory (Central: 7 tables; Branch A: 10 tables) | Read-only catalog query | Automated / Operator | Matches baseline |
| 5 | Confirm application row counts (`employees=0`, `leave_requests=0`, `audit_logs=0`, `branches=0`) | Read-only `COUNT(*)` | Automated / Operator | `0` rows (clean pre-demo state) |
| 6 | Confirm `branch_config` singleton (`00000000-0000-0000-0000-000000000001`, `'BRANCH-A'`) | Read-only `SELECT` | Automated / Operator | 1 row, missing `is_active` |
| 7 | Confirm `nexus_internal` does not exist yet on Branch A | Read-only `pg_namespace` | Automated / Operator | Absent |
| 8 | Confirm baseline grants & RLS enabled on all tables | Read-only `pg_class`, `role_table_grants` | Automated / Operator | RLS `true` on all tables |
| 9 | **Take/verify Supabase backups or PITR restore point** for both projects | **Operator Action** (Supabase Dashboard) | **Operator** | Confirmed snapshot before Stage 1 |
| 10 | Verify SHA-256 hashes of all 5 local SQL files match Phase 3.12F Section 3 | Local `Get-FileHash` | Automated / Operator | Exact match (verified) |
