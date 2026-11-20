# SQL Compatibility Remediation v2.7.2 — Validation Results & Regression Checklist

**Date:** 2026-11-12  
**PostgreSQL Runtime Test Status:** **`NOT VERIFIED — POSTGRESQL 17 RUNTIME TEST UNAVAILABLE`**

---

## 1. Static Validation Results

| Check | Status | Notes |
| :--- | :--- | :--- |
| Transaction atomicity | **PASS (Static)** | Wrapped in `BEGIN; ... COMMIT;`; any exception rolls back cleanly. |
| Statement ordering | **PASS (Static)** | Precondition -> catalog inspection -> DDL -> postcondition verification. |
| Idempotency | **PASS (Static)** | Handles both missing `is_active` and already-present `is_active`. |
| Unrelated field preservation | **PASS (Static)** | Compares `v_before` and `v_after` across all 6 baseline columns. |
| PostgreSQL 17 runtime execution | **`NOT VERIFIED`** | Local PG17 runtime unavailable (`where.exe psql docker pg_ctl postgres` empty). |

---

## 2. Regression Test Checklist (Expected Behavior — Live Execution `NOT VERIFIED`)

| # | Scenario | Expected Behavior | Execution Status |
| :--- | :--- | :--- | :--- |
| 1 | Fresh baseline (`is_active` missing) | Adds `is_active BOOLEAN NOT NULL DEFAULT TRUE`; singleton has `TRUE`; unrelated fields unchanged. | `NOT VERIFIED` |
| 2 | Existing `is_active = TRUE` | Preserves `TRUE`; verifies type/default/`NOT NULL`. | `NOT VERIFIED` |
| 3 | Existing `is_active = FALSE` | Preserves `FALSE`; enforces `DEFAULT TRUE` & `NOT NULL` without overwriting `FALSE`. | `NOT VERIFIED` |
| 4 | Existing nullable `is_active` with `NULL` | Backfills `NULL -> TRUE` (`WHERE is_active IS NULL`); sets `NOT NULL`. | `NOT VERIFIED` |
| 5 | Incompatible column type (e.g., `TEXT`) | Raises exception (`Compatibility halted`) and rolls back. | `NOT VERIFIED` |
| 6 | Missing `BRANCH-A` singleton (0 rows) | Raises exception (`expected exactly 1 row`) and rolls back; does not create data. | `NOT VERIFIED` |
| 7 | Duplicate/unexpected rows (>1 row) | Raises exception (`expected exactly 1 row`) and rolls back. | `NOT VERIFIED` |
| 8 | Re-running `v2.7.2` migration | Succeeds idempotently with `NOTICE` and zero data changes. | `NOT VERIFIED` |
| 9 | Subsequent `v2.7.1` precondition (`L59`) | `SELECT id, branch_code, is_active` succeeds cleanly. | `NOT VERIFIED` |
| 10 | `verify_gateway_actor()` reading `is_active` | Passes when `is_active = TRUE`; rejects `42501` when `is_active = FALSE`. | `NOT VERIFIED` |
