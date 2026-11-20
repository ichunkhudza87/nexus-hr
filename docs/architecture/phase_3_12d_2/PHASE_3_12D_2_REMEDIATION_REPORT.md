# Phase 3.12D.2 — Local SQL Security Remediation Report

**Date:** 2026-11-12  
**Project:** NEXUS HR (`D:\Antigravity_Projects\nexus-hr`)  
**Mode:** STRICTLY LOCAL-ONLY  
**Canonical Refs:** Branch A = `uneycmbqqpkifwhwzbes`, Central = `wcmevigbqsmzsdqidjel`

---

## 1. Remediations Implemented in `v2.7.1`

### A. `D1-01` [CRITICAL] — `service_role` Mutation Bypass Closed
- **Changes in `001_branch_a_security_remediation_v2_7_1.sql`:**
  - `public.leave_requests`: Revoked `INSERT, UPDATE, DELETE, TRUNCATE` from `PUBLIC, anon, service_role`; revoked `UPDATE, DELETE, TRUNCATE` from `authenticated` (preserving `SELECT, INSERT` for `leave_self_submit` RLS). `service_role` retains `SELECT` only and mutates solely through `SECURITY DEFINER` RPCs (`rpc_branch_decide_leave_request`, `rpc_superadmin_update_leave_request`) owned by `postgres`.
  - `public.audit_logs`: Revoked `INSERT, UPDATE, DELETE, TRUNCATE` from `PUBLIC, anon, authenticated, service_role`. Audit writes occur strictly via `record_branch_audit_log()` (`SECURITY DEFINER`, `OWNER TO postgres`).
  - `TRUNCATE` across all `public` tables revoked from `authenticated, service_role`.
  - Added `prevent_hard_delete_leave_requests()` (`BEFORE DELETE` trigger) and `prevent_truncate_protected_tables()` (`BEFORE TRUNCATE` statement trigger on `leave_requests` and `audit_logs`). Note: triggers do not protect against `postgres` / superuser or table-owner actions; primary defense is privilege `REVOKE`.
  - Extended `trg_audit_leave_requests` to `AFTER INSERT OR UPDATE OR DELETE`.
  - Revoked unnecessary `EXECUTE` on trigger functions from `service_role`.

### B. `D1-02` [HIGH] — `nexus_internal.tx_actor_context.key_id` Upgrade Drift Eliminated
- Added `ALTER TABLE nexus_internal.tx_actor_context ADD COLUMN IF NOT EXISTS key_id VARCHAR(64);`.
- Before applying `NOT NULL`, inspects existing `NULL` rows without inventing key IDs:
  - Fails safely (`RAISE EXCEPTION`) if any active/recent (`verified_at >= now() - INTERVAL '5 minutes'`) `NULL` rows exist.
  - Cleans only stale orphaned rows (`verified_at < now() - INTERVAL '5 minutes'`), re-checks zero `NULL`s remain, applies `ALTER COLUMN key_id SET NOT NULL`, and verifies `character varying(64)` + `NOT NULL` via `pg_attribute`.

### C. `D1-03` [MEDIUM] — Deterministic `SUPERADMIN` `CORRECTION` Approval Metadata Rule
- Updated `rpc_superadmin_update_leave_request()` and `enforce_leave_decision_integrity()`:
  - When `CORRECTION` transitions `PENDING -> APPROVED` or `PENDING -> REJECTED` with `p_set_approved_by = FALSE` / `p_set_approved_at = FALSE`, `approved_by` and `approved_at` are deterministically populated with `actor_user_id` and `now()`.
  - Existing metadata is preserved when already decided or when no transition requires stamping.
  - Explicit `NULL` (`p_set_approved_by = TRUE, p_approved_by = NULL` or `p_set_approved_at = TRUE, p_approved_at = NULL`) on `APPROVED`/`REJECTED` rows is rejected (`23514`); explicit `NULL` on `PENDING` rows clears metadata cleanly.

### D. `D1-04` [LOW/MEDIUM] — Nonce Cleanup Moved Out of Gateway RPC Path
- Removed the 5% probabilistic `cleanup_expired_actor_nonces(50)` call from `verify_gateway_actor()`.
- Retained `nexus_internal.cleanup_expired_actor_nonces(INTEGER)` (`FOR UPDATE SKIP LOCKED`, `OWNER TO postgres`) for controlled scheduled maintenance (e.g., `pg_cron`).

---

## 2. File Inventory & Immutability Evidence

### Created Files (`v2.7.1` & `phase_3_12d_2`)
- `supabase/remediation/v2.7.1/001_branch_a_security_remediation_v2_7_1.sql` (`SHA-256: 10394258BA64D8F1B1DA5847C5D3349209291FF384063F7EB03D2E2DCBFDE756`)
- `supabase/remediation/v2.7.1/002_central_seed_and_rollback_v2_7_1.sql` (`SHA-256: C4A9742D7030D4BDD93C7E0487F03EE9827DC27EABF691A976F6C559ED69DE54`)
- `supabase/remediation/v2.7.1/SQL_V2_7_1_CHANGELOG.md`
- `supabase/remediation/v2.7.1/SQL_V2_7_1_CONTRACT.md`
- `supabase/remediation/v2.7.1/SQL_V2_7_1_ROLLBACK_PLAN.md`
- `supabase/remediation/v2.7.1/SQL_V2_7_1_PRIVILEGE_MATRIX.md`
- `supabase/remediation/v2.7.1/SQL_V2_7_1_VALIDATION_RESULTS.md`
- `docs/architecture/phase_3_12d_2/PHASE_3_12D_2_REMEDIATION_REPORT.md`
- `docs/architecture/phase_3_12d_2/PHASE_3_12D_2_POSTGRESQL17_TEST_REPORT.md`
- `docs/architecture/phase_3_12d_2/PHASE_3_12D_2_SECURITY_REGRESSION_REPORT.md`
- `docs/architecture/phase_3_12d_2/PHASE_3_12D_2_READINESS_DECISION.md`

### Preserved Unmodified Files (Verified SHA-256)
- `supabase/remediation/v2.7/001_branch_a_security_remediation_v2_7.sql`: `7F062E115B7A680C9913579072B3BE1694F374F6EA4E7988D0363E38C4EC5CB4`
- `supabase/remediation/v2.7/002_central_seed_and_rollback_v2_7.sql`: `8C60141CF1660F7E2D3102590A07586C6824E8647EEBA99F5DED0E13F8A6DB81`
- `supabase/migrations/001_central_schema.sql`: `02447A8F2923ED49235DDD77D5EED33D47B0E023F0108A6495BDD7CC1C9C0260`
- `supabase/migrations/002_branch_a_schema.sql`: `F1C8960FA8504E6AC9DD134FAC9BE68768DBDAF33FAED4A5B3F402D541874EC1`
