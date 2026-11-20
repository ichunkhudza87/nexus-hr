# SQL Compatibility Remediation v2.7.2 — Rollback Plan

**Date:** 2026-11-12  
**Target:** Branch A (`uneycmbqqpkifwhwzbes`)

---

## 1. Rollback Procedure

If `000_branch_a_config_compatibility_v2_7_2.sql` must be reversed (only when `001_branch_a_security_remediation_v2_7_1.sql` is NOT installed or has already been rolled back, since `verify_gateway_actor()` depends on `is_active`):

```sql
BEGIN;

ALTER TABLE public.branch_config
    DROP COLUMN IF EXISTS is_active;

COMMIT;
```

## 2. Safety Notes

- Dropping `is_active` does not affect any baseline `002_branch_a_schema.sql` object or existing `branch_config` fields (`id`, `branch_code`, `branch_name`, `operating_timezone`, `attendance_grace_period_mins`, `max_overtime_hours_per_day`, `updated_at`).
- Do **NOT** drop `is_active` while `001_branch_a_security_remediation_v2_7_1.sql` is active, as `verify_gateway_actor()` queries `public.branch_config.is_active`.
