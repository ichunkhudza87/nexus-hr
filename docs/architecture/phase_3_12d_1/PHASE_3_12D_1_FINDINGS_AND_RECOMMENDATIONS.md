# Phase 3.12D.1 — Findings and Recommendations

**Date:** 2026-11-12  
**Project:** NEXUS HR  
**Audited Files:**
- `supabase/remediation/v2.7/001_branch_a_security_remediation_v2_7.sql` (lines 1–1140)
- `supabase/remediation/v2.7/002_central_seed_and_rollback_v2_7.sql` (lines 1–115)
- `supabase/migrations/002_branch_a_schema.sql` (baseline privilege & trigger context)

---

## 1. Summary Table

| Finding ID | Severity | Status | Affected Object | Requires New Version? |
| :--- | :--- | :--- | :--- | :--- |
| **`D1-01`** | **CRITICAL** | **Blocking** | `public.leave_requests`, `public.audit_logs`, `service_role` | **Yes (`v2.7.1` / `v2.8`)** |
| **`D1-02`** | **HIGH** | **Blocking** | `nexus_internal.tx_actor_context.key_id` | **Yes (`v2.7.1` / `v2.8`)** |
| **`D1-03`** | **MEDIUM** | **Open** | `rpc_superadmin_update_leave_request`, `enforce_leave_decision_integrity()` | **Yes (`v2.7.1` / `v2.8`)** |
| **`D1-04`** | **LOW/MEDIUM** | **Operational Note** | `verify_gateway_actor()`, `used_actor_nonces` | No (Optional hardening) |
| **`D1-05`** | **MEDIUM** | **Blocking (Verification)** | Entire v2.7 SQL (`001` & `002`) | Verification step (PG17) |
| **`D1-06`** | **HIGH** | **Blocking (Preflight)** | Branch A project ref & read-only preflight | Owner confirmation |

---

## 2. Detailed Findings

### `D1-01` — `service_role` Retains Direct `INSERT`, `DELETE`, `TRUNCATE` on `public.leave_requests` and Full DML on `public.audit_logs`
- **Finding ID:** `D1-01`
- **Severity:** **CRITICAL**
- **Exact SQL File & Line:**
  - `supabase/migrations/002_branch_a_schema.sql:L1101` (`GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;`)
  - `supabase/migrations/002_branch_a_schema.sql:L570-L572` (`trg_audit_leave_requests` defined for `AFTER INSERT OR UPDATE` only — no `AFTER DELETE`)
  - `supabase/remediation/v2.7/001_branch_a_security_remediation_v2_7.sql:L726-L728` (`trg_01_enforce_leave_decision` defined for `BEFORE UPDATE` only — no `BEFORE DELETE`)
  - `supabase/remediation/v2.7/001_branch_a_security_remediation_v2_7.sql:L999-L1002` (`REVOKE` applied only to `PUBLIC, anon, authenticated`, NOT `service_role`)
- **Affected Object:** `public.leave_requests`, `public.audit_logs`, `service_role`
- **Evidence:** Baseline migration grants `ALL ON ALL TABLES IN SCHEMA public TO service_role`, and `001_branch_a_security_remediation_v2_7.sql` only revokes direct DML from `PUBLIC, anon, authenticated`. Meanwhile, `service_role` has `BYPASSRLS = true`, and neither `trg_01_enforce_leave_decision` nor `trg_audit_leave_requests` fires on `DELETE` or `TRUNCATE`.
- **Exploit / Failure Scenario:** A compromised Sync Worker, misconfigured backend service, or direct PostgREST `service_role` request can execute `DELETE` or `TRUNCATE` on `public.leave_requests` or `public.audit_logs`—completely bypassing `verify_gateway_actor()`, `tx_actor_context`, `enforce_leave_decision_integrity()`, and `record_branch_audit_log()` with zero audit trail. It can also directly `INSERT` pre-`APPROVED` rows into `leave_requests`.
- **Impact:** Complete bypass of leave decision integrity and immutable audit logging by any `service_role` caller.
- **Recommended Correction:**
  1. `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.leave_requests FROM service_role;` (or restrict `INSERT` strictly if no non-RPC worker needs it, and definitely revoke `UPDATE, DELETE, TRUNCATE`).
  2. `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.audit_logs FROM service_role;`
  3. `REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM service_role;`
  4. Add a `BEFORE DELETE` guard trigger raising `42501` and an `AFTER DELETE` audit trigger on `public.leave_requests`.
- **Requires New Remediation Version?:** **Yes — `v2.7.1` / `v2.8` required before execution.**

---

### `D1-02` — Upgrade Schema Drift on `nexus_internal.tx_actor_context.key_id` (`NOT NULL` vs Nullable)
- **Finding ID:** `D1-02`
- **Severity:** **HIGH**
- **Exact SQL File & Line:** `supabase/remediation/v2.7/001_branch_a_security_remediation_v2_7.sql:L115-L130`
- **Affected Object:** `nexus_internal.tx_actor_context.key_id`
- **Evidence:** `CREATE TABLE IF NOT EXISTS nexus_internal.tx_actor_context` declares `key_id VARCHAR(64) NOT NULL` at `L124`, whereas the idempotent upgrade block `ALTER TABLE nexus_internal.tx_actor_context ADD COLUMN IF NOT EXISTS key_id VARCHAR(64)` at `L128-L129` omits `NOT NULL`.
- **Exploit / Failure Scenario:** Upgrading an existing v2.6 `tx_actor_context` table leaves `key_id` nullable, creating schema divergence between fresh installs and upgraded databases and weakening invariant enforcement on actor context rows.
- **Impact:** Schema drift between environments and missing `NOT NULL` constraint on `key_id` after upgrades.
- **Recommended Correction:** Clean/truncate any stale orphaned rows in `nexus_internal.tx_actor_context` during migration and execute `ALTER TABLE nexus_internal.tx_actor_context ALTER COLUMN key_id SET NOT NULL;`.
- **Requires New Remediation Version?:** **Yes — `v2.7.1` / `v2.8` required.**

---

### `D1-03` — `SUPERADMIN` `CORRECTION` Transition `PENDING -> APPROVED` Without `p_set_approved_by` Leaves `approved_by`/`approved_at` `NULL`
- **Finding ID:** `D1-03`
- **Severity:** **MEDIUM**
- **Exact SQL File & Line:**
  - `supabase/remediation/v2.7/001_branch_a_security_remediation_v2_7.sql:L640-L660` (`enforce_leave_decision_integrity`)
  - `supabase/remediation/v2.7/001_branch_a_security_remediation_v2_7.sql:L914-L928` (`rpc_superadmin_update_leave_request` `CORRECTION` branch)
- **Affected Object:** `public.rpc_superadmin_update_leave_request`, `public.enforce_leave_decision_integrity()`
- **Evidence:** In `CORRECTION` mode, when transitioning `status` from `'PENDING'` to `'APPROVED'` with `p_set_approved_by = FALSE`, neither the RPC nor the trigger populates `approved_by` or `approved_at`.
- **Exploit / Failure Scenario:** An `APPROVED` leave request can exist in `public.leave_requests` with `approved_by IS NULL` and `approved_at IS NULL`, violating approval accountability.
- **Impact:** Incomplete approver attribution on corrected leave requests that become `APPROVED` or `REJECTED`.
- **Recommended Correction:** When `CORRECTION` mode transitions a `PENDING` row into `APPROVED`/`REJECTED`, auto-stamp `COALESCE(v_existing.approved_by, p_actor_user_id)` and `COALESCE(v_existing.approved_at, now())` (or reject `NULL` approver metadata on decided statuses).
- **Requires New Remediation Version?:** **Yes — recommended in `v2.7.1` / `v2.8`.**

---

### `D1-04` — Nonce Claim Order & In-Transaction 5% Cleanup
- **Finding ID:** `D1-04`
- **Severity:** **LOW / MEDIUM**
- **Exact SQL File & Line:**
  - `supabase/remediation/v2.7/001_branch_a_security_remediation_v2_7.sql:L349-L360` (`INSERT INTO used_actor_nonces` + 5% probabilistic `cleanup_expired_actor_nonces(50)`)
  - `supabase/remediation/v2.7/001_branch_a_security_remediation_v2_7.sql:L408-L415` (`P0002` target check)
- **Affected Object:** `nexus_internal.verify_gateway_actor()`, `nexus_internal.used_actor_nonces`
- **Evidence:** Nonce insertion runs before the `P0002` target-existence check, and 5% of RPCs run a bounded `LIMIT 50 SKIP LOCKED` cleanup inside the user RPC transaction.
- **Exploit / Failure Scenario:** Missing `target_id` raises `P0002` and rolls back the nonce insert (mitigated because the HMAC payload binds to that exact non-existent `target_id` and `exp <= 120s`); 5% of RPCs incur minor cleanup overhead.
- **Impact:** Low — bounded by `SKIP LOCKED` and short `exp` window.
- **Recommended Correction:** Acceptable as-is for bounded non-blocking defense, or move nonce cleanup exclusively to a scheduled `pg_cron` job.
- **Requires New Remediation Version?:** **No (optional operational hardening).**

---

### `D1-05` — PostgreSQL 17 Parsing, `SECURITY DEFINER` `current_setting('role', true)`, and Bit-Cast Syntax Unverified Locally
- **Finding ID:** `D1-05`
- **Severity:** **MEDIUM (Blocking Verification Gap)**
- **Exact SQL File & Line:** `001_branch_a_security_remediation_v2_7.sql:L236, L358` and full 1140-line DDL/PLpgSQL + `002_central_seed_and_rollback_v2_7.sql:L1-L115`
- **Affected Object:** All v2.7 SQL objects
- **Evidence:** `psql`, `docker`, `pg_ctl`, and `postgres` are not installed locally (`where.exe` returned no binaries).
- **Exploit / Failure Scenario:** Unchecked syntax, overload-drop ordering, nested `SECURITY DEFINER` GUC behavior, or rollback edge cases could fail mid-deployment on Supabase PostgreSQL 17.
- **Impact:** Deployment failure risk if applied directly to remote databases without prior local PG17 execution.
- **Recommended Correction:** Run full baseline + remediation + negative security test suite on an isolated disposable PostgreSQL 17 instance before touching Supabase.
- **Requires New Remediation Version?:** **Verification step required before execution.**

---

### `D1-06` — Branch A Project Reference Discrepancy & No Verifiably Read-Only Remote Connection
- **Finding ID:** `D1-06`
- **Severity:** **HIGH (Blocking Preflight Discrepancy)**
- **Exact SQL File & Line:** Phase 3.12D.1 Section 5 (`uneycmbpkifwhwzbes`) vs `001_branch_a_security_remediation_v2_7.sql:L3`, `002_branch_a_schema.sql:L3`, `.env.example:L31` (`uneycmbqqpkifwhwzbes`)
- **Affected Object:** Branch A target project identification
- **Evidence:** Section 5 states `uneycmbpkifwhwzbes` (missing `qq`), whereas all repository files and prior phases specify `uneycmbqqpkifwhwzbes`. Additionally, no verified read-only remote DB connection is available in this session.
- **Exploit / Failure Scenario:** Executing against an unconfirmed project reference or using a read-write MCP connection violates Phase 3.12D.1 safety boundaries.
- **Impact:** Preflight verification cannot proceed until resolved.
- **Recommended Correction:** Confirm canonical Branch A project ref (`uneycmbqqpkifwhwzbes`) and provision an explicit read-only connection if remote catalog preflight is required.
- **Requires New Remediation Version?:** **Owner confirmation required.**
