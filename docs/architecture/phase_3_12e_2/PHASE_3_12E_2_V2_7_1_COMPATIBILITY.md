# Phase 3.12E.2 — Compatibility Audit with SQL v2.7.1

**Date:** 2026-11-12  
**PostgreSQL Runtime Validation:** **`NOT VERIFIED — POSTGRESQL 17 RUNTIME TEST UNAVAILABLE`**

---

## 1. `public.branch_config.is_active` Cross-Reference

| `001_branch_a_security_remediation_v2_7_1.sql` Location | Usage | Satisfied by `v2.7.2`? |
| :--- | :--- | :--- |
| `L45` | `IF to_regclass('public.branch_config') IS NULL` | **Yes (Static)** |
| `L59-L66` (Fail-fast precondition) | `SELECT id, branch_code, is_active INTO v_branch_cfg FROM public.branch_config LIMIT 1;` | **Yes (Static)** — `is_active` is `BOOLEAN NOT NULL DEFAULT TRUE` |
| `L433-L438` (`verify_gateway_actor()`) | `SELECT id, branch_code, is_active INTO v_branch_cfg ...; IF NOT FOUND OR v_branch_cfg.is_active IS NOT TRUE THEN ...` | **Yes (Static)** — `TRUE` allows, `FALSE` rejects with `42501` |

No other `public.branch_config` column is referenced anywhere in `001_branch_a_security_remediation_v2_7_1.sql`.
