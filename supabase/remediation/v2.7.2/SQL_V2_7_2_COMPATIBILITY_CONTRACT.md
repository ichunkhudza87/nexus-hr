# SQL Compatibility Remediation v2.7.2 — Compatibility Contract

**Date:** 2026-11-12  
**Execution Order:**
1. `000_branch_a_config_compatibility_v2_7_2.sql` (Branch A `uneycmbqqpkifwhwzbes`)
2. `001_branch_a_security_remediation_v2_7_1.sql` (Branch A `uneycmbqqpkifwhwzbes`)
3. `002_central_seed_and_rollback_v2_7_1.sql` (Central `wcmevigbqsmzsdqidjel`)

---

## 1. Compatibility Guarantee with `v2.7.1`

`001_branch_a_security_remediation_v2_7_1.sql` references `public.branch_config` at:
- **Line 45:** `IF to_regclass('public.branch_config') IS NULL`
- **Line 59–66:** `SELECT id, branch_code, is_active INTO v_branch_cfg FROM public.branch_config LIMIT 1;`
- **Line 433–438 (`verify_gateway_actor()`):** `SELECT id, branch_code, is_active INTO v_branch_cfg FROM public.branch_config WHERE id = '00000000-0000-0000-0000-000000000001'::uuid; IF NOT FOUND OR v_branch_cfg.is_active IS NOT TRUE THEN ...`

After `000_branch_a_config_compatibility_v2_7_2.sql` completes:
- `public.branch_config.is_active` exists as `BOOLEAN NOT NULL DEFAULT TRUE`.
- Existing `BRANCH-A` singleton defaults to `is_active = TRUE` unless explicitly set to `FALSE`.
- No other `branch_config` columns are required by `v2.7.1`.

---

## 2. NULL-Value Policy

If `is_active` already exists as a nullable `BOOLEAN` column containing `NULL`, `v2.7.2` backfills `is_active = TRUE WHERE is_active IS NULL` on the canonical `BRANCH-A` singleton before enforcing `NOT NULL`. Any explicit `FALSE` value is preserved untouched.
