# Phase 3.12E.2 — Transaction, Ordering & Rollback Audit

**Date:** 2026-11-12  
**PostgreSQL Runtime Validation:** **`NOT VERIFIED — POSTGRESQL 17 RUNTIME TEST UNAVAILABLE`**

---

## 1. Transaction & Retry Safety

- `000_branch_a_config_compatibility_v2_7_2.sql` wraps all checks and DDL inside `BEGIN;` (`L14`) ... `COMMIT;` (`L141`).
- Any precondition failure (`L28, L33, L48`), incompatible type (`L71`), or postcondition failure (`L98, L117, L136`) aborts and rolls back the transaction with zero partial DDL state.
- Safe to retry: re-running after completion takes the `ELSE` branch (`L68-L93`) idempotently.

## 2. Migration Ordering

1. **Branch A (`uneycmbqqpkifwhwzbes`):** `000_branch_a_config_compatibility_v2_7_2.sql`
2. **Branch A (`uneycmbqqpkifwhwzbes`):** `001_branch_a_security_remediation_v2_7_1.sql`
3. **Central (`wcmevigbqsmzsdqidjel`):** `002_central_seed_and_rollback_v2_7_1.sql` (separate database execution)

## 3. Rollback Assessment (`E2-02`)

- `SQL_V2_7_2_ROLLBACK_PLAN.md` correctly warns that `is_active` must **not** be dropped while `001_branch_a_security_remediation_v2_7_1.sql` is installed.
- Note `E2-02`: If `is_active = FALSE` was ever set operationally, dropping `is_active` discards that state; preserving the column is preferred unless performing a full baseline revert.
