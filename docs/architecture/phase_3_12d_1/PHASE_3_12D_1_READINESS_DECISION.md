# Phase 3.12D.1 — Readiness Decision

**Date:** 2026-11-12  
**Project:** NEXUS HR  
**Audit Scope:** SQL Remediation v2.7 (`supabase/remediation/v2.7/001_branch_a_security_remediation_v2_7.sql` & `002_central_seed_and_rollback_v2_7.sql`)

---

## 1. Final Verdict

# **NOT READY — REMEDIATION REQUIRED**

SQL Remediation v2.7 **MUST NOT** be executed against `nexus-branch-a` or `nexus-central` in its current state.

---

## 2. Blocking Reasons

1. **`D1-01` [CRITICAL] — `service_role` Direct DML/TRUNCATE & Missing `DELETE` Guards:**
   - `service_role` retains `ALL ON ALL TABLES IN SCHEMA public` from `002_branch_a_schema.sql:L1101`, including direct `INSERT`, `DELETE`, and `TRUNCATE` on `public.leave_requests` and `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` on `public.audit_logs`.
   - `trg_01_enforce_leave_decision` (`BEFORE UPDATE`) and `trg_audit_leave_requests` (`AFTER INSERT OR UPDATE`) do not fire on `DELETE` or `TRUNCATE`.
   - **Required Fix (v2.7.1 / v2.8):** Revoke `INSERT, UPDATE, DELETE, TRUNCATE` on `leave_requests` and `audit_logs` from `service_role`, revoke `TRUNCATE` on all `public` tables from `service_role`, and add `BEFORE DELETE` + `AFTER DELETE` triggers on `leave_requests`.

2. **`D1-02` [HIGH] — `tx_actor_context.key_id` Upgrade Schema Drift:**
   - `CREATE TABLE IF NOT EXISTS` declares `key_id VARCHAR(64) NOT NULL` (`L124`), while `ALTER TABLE ... ADD COLUMN IF NOT EXISTS key_id VARCHAR(64)` (`L128-L129`) omits `NOT NULL`.
   - **Required Fix (v2.7.1 / v2.8):** Clean stale rows and enforce `ALTER COLUMN key_id SET NOT NULL`.

3. **`D1-03` [MEDIUM] — `SUPERADMIN` `CORRECTION` Transition `PENDING -> APPROVED` Missing Approver Attribution:**
   - Transitioning `PENDING -> APPROVED` with `p_set_approved_by = FALSE` leaves `approved_by` and `approved_at` `NULL`.
   - **Required Fix (v2.7.1 / v2.8):** Auto-stamp `COALESCE(v_existing.approved_by, p_actor_user_id)` and `COALESCE(v_existing.approved_at, now())` when transitioning `PENDING -> APPROVED/REJECTED`.

4. **`D1-05` [MEDIUM] — PostgreSQL 17 Execution & Parsing `NOT VERIFIED`:**
   - No local PostgreSQL 17 (`psql` / `docker` / `postgres`) runtime is available; all syntax, nested `SECURITY DEFINER` GUC checks (`L236`), bit-casts (`L358`), and rollback behavior remain unexecuted.

5. **`D1-06` [HIGH] — Branch A Project Reference Discrepancy & Unexecuted Remote Preflight:**
   - Phase 3.12D.1 Section 5 lists `uneycmbpkifwhwzbes` whereas repository files (`001_branch_a_security_remediation_v2_7.sql:L3`, `002_branch_a_schema.sql:L3`, `.env.example:L31`) use `uneycmbqqpkifwhwzbes`.

---

## 3. Recommended Next Steps

1. Owner confirms canonical Branch A project reference (`uneycmbqqpkifwhwzbes`).
2. Authorize **SQL Remediation v2.7.1 / v2.8** to close `D1-01`, `D1-02`, and `D1-03`.
3. Authorize **Phase 3.12D.2** in a disposable PostgreSQL 17 environment to verify full DDL/PLpgSQL execution, negative security tests, and rollback before any remote Supabase deployment.

---

## 4. Final Safety Confirmation (Section 8)

- **No remote SQL was executed** against `nexus-central` or `nexus-branch-a`.
- **No remote database objects, privileges, triggers, or data were modified.**
- **No local SQL migration files, remediation drafts, or Gateway source files were modified.**
- **No production HMAC secrets were generated, read, or inserted.**
- **No legacy projects (`bolt`, `cbt`, `nusantara`) were accessed or modified.**
