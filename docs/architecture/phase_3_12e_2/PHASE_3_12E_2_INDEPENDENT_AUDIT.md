# Phase 3.12E.2 — Independent Read-Only Audit (v2.7.2 Compatibility Patch)

**Date:** 2026-11-12  
**Role:** Independent Senior PostgreSQL Security Auditor  
**Mode:** STRICT READ-ONLY AUDIT  
**Primary Audited File:** `supabase/remediation/v2.7.2/000_branch_a_config_compatibility_v2_7_2.sql` (141 lines)

---

## 1. Executive Summary

An independent line-by-line audit of `000_branch_a_config_compatibility_v2_7_2.sql` confirms that it safely resolves Phase 3.12E blocker `E-01` (`public.branch_config.is_active` missing on `nexus-branch-a`) without modifying baseline data, without recreating `branch_config`, and with full `BEGIN ... COMMIT` atomicity.

**PostgreSQL Runtime Validation Status:** **`NOT VERIFIED — POSTGRESQL 17 RUNTIME TEST UNAVAILABLE`** (no local PG17 runtime; no remote SQL executed).

---

## 2. Audit Matrix (Areas A–H)

| Area | Static Verdict | Runtime Status | Notes |
| :--- | :--- | :--- | :--- |
| **A. Schema compatibility** | **PASS (Static)** | `NOT VERIFIED` | Preserves all 6 baseline columns + `updated_at`; no table drop/recreate. |
| **B. Column addition** | **PASS (Static)** | `NOT VERIFIED` | Adds `BOOLEAN NOT NULL DEFAULT TRUE`, rejects non-boolean types, preserves `FALSE`, backfills `NULL -> TRUE`. |
| **C. Snapshot integrity** | **PASS (Static)** | `NOT VERIFIED` | Compares all 6 baseline columns via `IS DISTINCT FROM` (`E2-01` LOW concurrency note). |
| **D. Singleton integrity** | **PASS (Static)** | `NOT VERIFIED` | Enforces `count(*) = 1`, `00000000-0000-0000-0000-000000000001`, and `'BRANCH-A'`. |
| **E. Transaction safety** | **PASS (Static)** | `NOT VERIFIED` | Single `BEGIN; ... COMMIT;`; any exception rolls back cleanly. |
| **F. `v2.7.1` compatibility** | **PASS (Static)** | `NOT VERIFIED` | Satisfies `001_..._v2_7_1.sql` lines `L45`, `L59-66`, `L433-438`. |
| **G. Migration ordering** | **PASS (Static)** | `NOT VERIFIED` | `v2.7.2` -> `v2.7.1` on Branch A; Central seed separately on Central. |
| **H. Rollback** | **PASS (Static)** | `NOT VERIFIED` | Safe if `v2.7.1` is absent/rolled back (`E2-02` LOW operational note on preserving `is_active = FALSE`). |

---

## 3. Non-Blocking Findings

### `E2-01` — Snapshot Query Precedes `ACCESS EXCLUSIVE` Lock Without `FOR UPDATE`
- **Finding ID:** `E2-01`
- **Severity:** **LOW (Informational)**
- **Exact File & Line:** `supabase/remediation/v2.7.2/000_branch_a_config_compatibility_v2_7_2.sql:L36-L44, L66`
- **Evidence:** `SELECT ... INTO v_before FROM public.branch_config LIMIT 1;` (`L36-L44`) does not use `FOR UPDATE` before `ALTER TABLE` (`L66`).
- **Risk:** A concurrent `UPDATE` between `L44` and `L66` would cause `v_after IS DISTINCT FROM v_before` (`L111-L117`) to raise an exception and roll back safely (zero silent corruption).
- **Recommended Resolution:** Optional; no change required because post-check fails closed.
- **Runtime Validation Requirement:** `NOT VERIFIED — POSTGRESQL 17 RUNTIME TEST UNAVAILABLE`.

### `E2-02` — Rollback `DROP COLUMN is_active` Discards Post-Deployment `FALSE` State
- **Finding ID:** `E2-02`
- **Severity:** **LOW (Operational Note)**
- **Exact File & Line:** `supabase/remediation/v2.7.2/SQL_V2_7_2_ROLLBACK_PLAN.md:L15-L16`
- **Evidence:** Rollback executes `ALTER TABLE public.branch_config DROP COLUMN IF EXISTS is_active;`.
- **Risk:** If `is_active` were ever set to `FALSE` operationally, dropping the column would lose that state.
- **Recommended Resolution:** Prefer preserving `is_active` during partial rollbacks unless reverting strictly to baseline schema.
- **Runtime Validation Requirement:** `NOT VERIFIED — POSTGRESQL 17 RUNTIME TEST UNAVAILABLE`.
