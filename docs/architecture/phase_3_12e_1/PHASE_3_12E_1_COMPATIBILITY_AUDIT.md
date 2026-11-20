# Phase 3.12E.1 — Compatibility Audit Report (v2.7.2 -> v2.7.1)

**Date:** 2026-11-12  
**PostgreSQL Runtime Status:** **`NOT VERIFIED — POSTGRESQL 17 RUNTIME TEST UNAVAILABLE`**

---

## 1. Compatibility with `001_branch_a_security_remediation_v2_7_1.sql`

Inspected all references to `public.branch_config` in `001_branch_a_security_remediation_v2_7_1.sql`:
- **`L45`:** `IF to_regclass('public.branch_config') IS NULL` -> Satisfied.
- **`L59-L66` (Fail-fast precondition):** `SELECT id, branch_code, is_active INTO v_branch_cfg FROM public.branch_config LIMIT 1;` -> Resolves `is_active BOOLEAN NOT NULL` added by `v2.7.2`.
- **`L433-L438` (`verify_gateway_actor()`):** `SELECT id, branch_code, is_active INTO v_branch_cfg FROM public.branch_config WHERE id = '00000000-0000-0000-0000-000000000001'::uuid; IF NOT FOUND OR v_branch_cfg.is_active IS NOT TRUE THEN ...` -> Resolves `is_active` and enforces active branch status as intended.
- **Additional missing columns:** None.

---

## 2. Static Validation & Remaining Risks

- **Static Validation:** Transaction atomicity, statement ordering, idempotency, catalog checks, and unrelated-field preservation all pass static review.
- **Remaining Risk:** Local PostgreSQL 17 runtime execution is **`NOT VERIFIED — POSTGRESQL 17 RUNTIME TEST UNAVAILABLE`**. Live execution against PostgreSQL 17 (either in an isolated PG17 environment or during an authorized staged execution window) is still required to confirm runtime behavior.
