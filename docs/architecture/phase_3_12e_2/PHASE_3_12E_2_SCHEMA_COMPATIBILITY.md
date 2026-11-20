# Phase 3.12E.2 — Schema & Snapshot Compatibility Audit

**Date:** 2026-11-12  
**Audited Files:** `002_branch_a_schema.sql` (`L82-L98`) & `000_branch_a_config_compatibility_v2_7_2.sql` (`L27-L138`)

---

## 1. Baseline & Column Addition Verification

- **Baseline `branch_config` (`002_branch_a_schema.sql:L82-L94`):** `id`, `branch_code`, `branch_name`, `operating_timezone`, `attendance_grace_period_mins`, `max_overtime_hours_per_day`, `updated_at`, plus `chk_branch_config_singleton` and `uq_branch_config_code`.
- **Column Addition (`000_..._v2_7_2.sql:L53-L93`):**
  - Inspects `pg_attribute` (`L53-L62`). When absent (`IF NOT FOUND`, `L64`), adds `is_active BOOLEAN NOT NULL DEFAULT TRUE` (`L66`).
  - When present (`ELSE`, `L68`), rejects non-`boolean` (`L70-L73`), backfills only `WHERE is_active IS NULL` (`L83-L85`, preserving explicit `FALSE`), and enforces `DEFAULT TRUE` + `NOT NULL` (`L90-L91`).

## 2. Snapshot & Singleton Verification

- **Singleton (`L31-L34, L46-L50, L96-L99`):** Verifies `count(*) = 1`, `id = '00000000-0000-0000-0000-000000000001'::uuid`, and `branch_code = 'BRANCH-A'` both before and after DDL.
- **Snapshot (`L36-L44, L101-L118`):** Captures all 6 baseline configuration columns into `v_before` and compares against `v_after` using `IS DISTINCT FROM` (`NULL`-safe).
- **Catalog Post-Check (`L120-L138`):** Confirms `format_type = 'boolean'`, `attnotnull IS TRUE`, and `pg_get_expr(adbin, adrelid)` = `'true'`.
