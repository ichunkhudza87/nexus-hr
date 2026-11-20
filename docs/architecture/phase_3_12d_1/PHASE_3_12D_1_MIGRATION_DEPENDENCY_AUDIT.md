# NEXUS HR — PHASE 3.12D.1 MIGRATION DEPENDENCY AUDIT

**Files Audited:**
- `supabase/remediation/v2.7/001_branch_a_security_remediation_v2_7.sql`
- `supabase/remediation/v2.7/002_central_seed_and_rollback_v2_7.sql`

---

## 1. Execution Dependency & Transaction Safety (Section 3J)

| Check | Evidence in SQL v2.7 | Verdict |
|---|---|---|
| Transaction wrapper | Both `001_...` (`L22, L1140`) and `002_...` (`L8, L63`) wrap DDL/DML in explicit `BEGIN; ... COMMIT;` | **PASS** |
| Preconditions | `001_...` checks `branch_config`, `employees`, `leave_requests`, `audit_logs`, `sync_outbox`, `seq_branch_a_employee_code`, `pgcrypto` extension, and `BRANCH-A` canonical row (`L27-55`) | **PASS** |
| Overload cleanup | Explicitly drops v2.6 overloads: `verify_gateway_actor` (11 args, `L196-198`), `rpc_branch_decide_leave_request` (11 args, `L742-744`), `rpc_superadmin_update_leave_request` (20 args, `L745-748`) | **PASS** |
| Trigger drop/recreate order | Drops legacy & v2.7 triggers before `CREATE TRIGGER` on `leave_requests` (`L720-736`) and `employees` (`L1090-1107`) with `trg_01_*`, `trg_02_*`, `trg_03_*` deterministic ordering | **PASS** |
| Sequence alteration | `ALTER SEQUENCE public.seq_branch_a_employee_code MAXVALUE 999999999999 NO CYCLE;` (`L1007-1009`) | **PASS** |
| Upgrade idempotency | **Defect `D1-02` (`L128-129`):** `ALTER TABLE nexus_internal.tx_actor_context ADD COLUMN IF NOT EXISTS key_id VARCHAR(64)` omits `NOT NULL`, creating nullable drift if upgrading from an existing v2.6 `tx_actor_context` table | **WARN / FIX (`D1-02`)** |
| Rollback script (`SQL_V2_7_ROLLBACK_PLAN.md`) | Drops v2.7 12/24-arg RPCs and restores baseline triggers; keeps `leave_requests` `UPDATE` revoked by default for safety. Central rollback uses `FOR UPDATE` row lock across 4 FK tables | **PASS** |
| PostgreSQL 17 syntax parsing | **NOT VERIFIED** — no local `psql`/PG17 instance available | **NOT VERIFIED (`D1-08`)** |
